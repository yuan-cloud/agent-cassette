import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export type CassetteMode = "record" | "replay" | "passthrough" | "auto";
export type CassetteHashProfile = "strict" | "lenient";

export type CassetteRecordedError = {
  name: string;
  message: string;
  stack?: string;
};

export type CassetteEntry = {
  cassette_version: 1;
  call_name: string;
  request_hash: string;
  recorded_at_ms: number;
  latency_ms?: number;
  args_preview?: unknown;
  result?: unknown;
  error?: CassetteRecordedError;
  meta?: Record<string, unknown>;
};

export type CassetteSessionStats = {
  mode: CassetteMode;
  calls_recorded: number;
  calls_replayed: number;
  replay_hits: number;
  replay_misses: number;
  total_tokens_recorded: number;
  total_tokens_saved_estimate: number;
};

export type CreateCassetteOptions = {
  cassetteFilePath: string;
  mode?: CassetteMode;
  redactValue?: (value: unknown) => unknown;
};

type UnknownRecord = Record<string, unknown>;

function sortKeysRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);

  if (value !== null && typeof value === "object") {
    const recordValue = value as UnknownRecord;
    const sortedKeys = Object.keys(recordValue).sort();
    const sortedRecord: UnknownRecord = {};
    for (const key of sortedKeys)
      sortedRecord[key] = sortKeysRecursively(recordValue[key]);
    return sortedRecord;
  }

  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeysRecursively(value));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultRedactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9_.-]+/g, "Bearer [REDACTED]") // Fixed regex
      .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]");           // Fixed regex
  }

  if (Array.isArray(value)) return value.map(defaultRedactValue);

  if (value !== null && typeof value === "object") {
    const recordValue = value as UnknownRecord;
    const redactedRecord: UnknownRecord = {};
    for (const [key, nestedValue] of Object.entries(recordValue)) {
      redactedRecord[key] = defaultRedactValue(nestedValue);
    }
    return redactedRecord;
  }

  return value;
}

function readJsonlEntries(cassetteFilePath: string): CassetteEntry[] {
  if (!existsSync(cassetteFilePath)) return [];
  const fileContents = readFileSync(cassetteFilePath, "utf8");
  return fileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CassetteEntry);
}

function getTotalTokensFromMeta(
  meta: Record<string, unknown> | undefined,
): number {
  if (!meta) return 0;
  const totalTokensCandidate = meta.total_tokens;
  return typeof totalTokensCandidate === "number" ? totalTokensCandidate : 0;
}

export function createCassette(createCassetteOptions: CreateCassetteOptions) {
  const resolvedMode = (createCassetteOptions.mode ?? "record") as CassetteMode;
  const redactValue = createCassetteOptions.redactValue ?? defaultRedactValue;

  const mode: CassetteMode =
    resolvedMode === "auto"
      ? existsSync(createCassetteOptions.cassetteFilePath)
        ? "replay"
        : "record"
      : resolvedMode;

  const cassetteFilePath = createCassetteOptions.cassetteFilePath;
  const existingEntries = readJsonlEntries(cassetteFilePath);

  const entriesByLookupKeyQueue = new Map<string, CassetteEntry[]>();
  for (const entry of existingEntries) {
    const lookupKey = `${entry.call_name}::${entry.request_hash}`;
    const existingQueue = entriesByLookupKeyQueue.get(lookupKey) ?? [];
    existingQueue.push(entry);
    entriesByLookupKeyQueue.set(lookupKey, existingQueue);
  }

  const sessionStats: CassetteSessionStats = {
    mode,
    calls_recorded: 0,
    calls_replayed: 0,
    replay_hits: 0,
    replay_misses: 0,
    total_tokens_recorded: 0,
    total_tokens_saved_estimate: 0,
  };

  function appendEntry(entry: CassetteEntry) {
    mkdirSync(dirname(cassetteFilePath), { recursive: true });
    const redactedEntry = redactValue(entry) as CassetteEntry;
    appendFileSync(
      cassetteFilePath,
      `${JSON.stringify(redactedEntry)}\n`,
      "utf8",
    );
  }

  function wrapAsyncFunction<ArgumentTuple extends readonly unknown[], TResult>(
    callName: string,
    realFunction: (...args: ArgumentTuple) => Promise<TResult>,
    options?: {
      buildRequestIdentity?: (args: ArgumentTuple) => unknown;
      buildArgsPreview?: (args: ArgumentTuple) => unknown;
      buildMeta?: (result: TResult) => Record<string, unknown> | undefined;
    },
  ) {
    const buildRequestIdentity =
      options?.buildRequestIdentity ?? ((args: ArgumentTuple) => args);
    const buildArgsPreview =
      options?.buildArgsPreview ?? ((args: ArgumentTuple) => args);
    const buildMeta = options?.buildMeta ?? (() => undefined);

    return async (...args: ArgumentTuple): Promise<TResult> => {
      const requestIdentity = buildRequestIdentity(args);
      const requestHash = sha256Hex(stableSerialize(requestIdentity));
      const lookupKey = `${callName}::${requestHash}`;

      if (mode === "replay") {
        sessionStats.calls_replayed += 1;

        const queue = entriesByLookupKeyQueue.get(lookupKey) ?? [];
        const nextEntry = queue.shift();
        if (!nextEntry) {
          sessionStats.replay_misses += 1;
          throw new Error(`Cassette miss: no entry for ${lookupKey}`);
        }

        sessionStats.replay_hits += 1;
        sessionStats.total_tokens_saved_estimate += getTotalTokensFromMeta(
          nextEntry.meta,
        );

        if (nextEntry.error) {
          const replayedError = new Error(nextEntry.error.message);
          replayedError.name = nextEntry.error.name;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (replayedError as any).stack = nextEntry.error.stack;
          throw replayedError;
        }

        return nextEntry.result as TResult;
      }

      if (mode === "passthrough") {
        return realFunction(...args);
      }

      const startTimeMs = Date.now();

      try {
        const result = await realFunction(...args);
        const latencyMs = Date.now() - startTimeMs;

        const meta = buildMeta(result);
        const entry: CassetteEntry = {
          cassette_version: 1,
          call_name: callName,
          request_hash: requestHash,
          recorded_at_ms: Date.now(),
          latency_ms: latencyMs,
          args_preview: buildArgsPreview(args),
          result,
          meta,
        };

        appendEntry(entry);

        sessionStats.calls_recorded += 1;
        sessionStats.total_tokens_recorded += getTotalTokensFromMeta(meta);

        return result;
      } catch (unknownError) {
        const latencyMs = Date.now() - startTimeMs;

        const errorObject =
          unknownError instanceof Error
            ? {
                name: unknownError.name,
                message: unknownError.message,
                stack: unknownError.stack,
              }
            : { name: "UnknownError", message: String(unknownError) };

        const entry: CassetteEntry = {
          cassette_version: 1,
          call_name: callName,
          request_hash: requestHash,
          recorded_at_ms: Date.now(),
          latency_ms: latencyMs,
          args_preview: buildArgsPreview(args),
          error: errorObject,
        };

        appendEntry(entry);
        sessionStats.calls_recorded += 1;

        throw unknownError;
      }
    };
  }

  function getSessionStats(): CassetteSessionStats {
    return { ...sessionStats };
  }

  return { wrapAsyncFunction, getSessionStats };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function normalizeInput(input: unknown): unknown {
  if (typeof input === "string") return normalizeNewlines(input).trim();

  if (Array.isArray(input)) {
    return input.map((messageLike) => {
      if (messageLike && typeof messageLike === "object") {
        const messageRecord = messageLike as UnknownRecord;
        const role =
          typeof messageRecord.role === "string"
            ? messageRecord.role
            : undefined;

        const rawContent = messageRecord.content;
        const normalizedContent =
          typeof rawContent === "string"
            ? normalizeNewlines(rawContent).trim()
            : rawContent;

        return { role, content: normalizedContent };
      }
      return messageLike;
    });
  }

  return input;
}

function normalizeToolDescriptors(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];

  const descriptors = tools.map((tool) => {
    if (!tool || typeof tool !== "object") return "unknown";

    const toolRecord = tool as UnknownRecord;
    const type =
      typeof toolRecord.type === "string" ? toolRecord.type : "unknown";

    const topLevelName =
      typeof toolRecord.name === "string" ? toolRecord.name : undefined;

    const nestedFunction = toolRecord.function;
    const nestedName =
      nestedFunction && typeof nestedFunction === "object"
        ? typeof (nestedFunction as UnknownRecord).name === "string"
          ? ((nestedFunction as UnknownRecord).name as string)
          : undefined
        : undefined;

    const name = topLevelName ?? nestedName;

    return name ? `${type}:${name}` : type;
  });

  return Array.from(new Set(descriptors)).sort();
}

export function createOpenAIResponsesRequestIdentity(
  requestParams: UnknownRecord,
  options?: { hashProfile?: CassetteHashProfile },
): UnknownRecord {
  const hashProfile = options?.hashProfile ?? "strict";

  const identity: UnknownRecord = {
    model: requestParams.model,
    instructions:
      typeof requestParams.instructions === "string"
        ? normalizeNewlines(requestParams.instructions).trim()
        : undefined,
    input: normalizeInput(requestParams.input),
    tools: normalizeToolDescriptors(requestParams.tools),
  };

  if (hashProfile === "strict") {
    identity.temperature =
      typeof requestParams.temperature === "number"
        ? requestParams.temperature
        : undefined;
    identity.top_p =
      typeof requestParams.top_p === "number" ? requestParams.top_p : undefined;
    identity.max_output_tokens =
      typeof requestParams.max_output_tokens === "number"
        ? requestParams.max_output_tokens
        : undefined;
    identity.tool_choice = requestParams.tool_choice;
  }

  return identity;
}

export function extractOpenAIUsageMeta(
  possibleOpenAIResponse: unknown,
): Record<string, unknown> | undefined {
  if (!possibleOpenAIResponse || typeof possibleOpenAIResponse !== "object")
    return undefined;
  const responseRecord = possibleOpenAIResponse as UnknownRecord;
  const usage = responseRecord.usage;

  if (!usage || typeof usage !== "object") return undefined;
  const usageRecord = usage as UnknownRecord;

  const totalTokens = usageRecord.total_tokens;
  const inputTokens = usageRecord.input_tokens;
  const outputTokens = usageRecord.output_tokens;

  if (typeof totalTokens !== "number") return undefined;

  return {
    total_tokens: totalTokens,
    input_tokens: typeof inputTokens === "number" ? inputTokens : undefined,
    output_tokens: typeof outputTokens === "number" ? outputTokens : undefined,
  };
}
