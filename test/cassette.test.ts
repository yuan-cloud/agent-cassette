import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCassette,
  createOpenAIResponsesRequestIdentity,
} from "../src/index";

describe.each(["strict", "lenient"] as const)(
  "OpenAI Responses request identity (%s)",
  (hashProfile) => {
    const request = {
      model: "synthetic-model",
      input: "Return a JSON result.",
    };
    const format = {
      type: "json_schema",
      name: "result",
      description: "A synthetic result",
      strict: true,
      schema: {
        type: "object",
        properties: { value: { type: "string", enum: ["ok", "pending"] } },
        required: ["value"],
        additionalProperties: false,
      },
    };
    const buildRequestIdentity = ([params]: [Record<string, unknown>]) =>
      createOpenAIResponsesRequestIdentity(params, { hashProfile });

    it("distinguishes JSON object and plain text output contracts", () => {
      const jsonIdentity = createOpenAIResponsesRequestIdentity(
        { ...request, text: { format: { type: "json_object" } } },
        { hashProfile },
      );
      const textIdentity = createOpenAIResponsesRequestIdentity(
        { ...request, text: { format: { type: "text" } } },
        { hashProfile },
      );

      expect(jsonIdentity).not.toEqual(textIdentity);
    });

    it.each([
      ["format type", { type: "json_object" }],
      ["format name", { ...format, name: "other_result" }],
      ["format description", { ...format, description: "A different result" }],
      ["schema adherence", { ...format, strict: false }],
      [
        "property type",
        {
          ...format,
          schema: {
            ...format.schema,
            properties: { value: { type: "number" } },
          },
        },
      ],
      [
        "enum values",
        {
          ...format,
          schema: {
            ...format.schema,
            properties: { value: { type: "string", enum: ["ok", "failed"] } },
          },
        },
      ],
      [
        "required fields",
        { ...format, schema: { ...format.schema, required: [] } },
      ],
      [
        "additional properties",
        { ...format, schema: { ...format.schema, additionalProperties: true } },
      ],
    ])("distinguishes changes to %s", (_label, changedFormat) => {
      expect(
        buildRequestIdentity([{ ...request, text: { format } }]),
      ).not.toEqual(
        buildRequestIdentity([{ ...request, text: { format: changedFormat } }]),
      );
    });

    it("misses changed contracts but replays reordered schema keys without calling the provider", async () => {
      const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
      const cassetteFilePath = join(cassetteFolderPath, "formats.jsonl");
      const recorder = createCassette({ cassetteFilePath, mode: "record" });
      const result = { output_text: '{"value":"ok"}' };
      const record = recorder.wrapAsyncFunction(
        "openai.responses.create",
        async (_params: Record<string, unknown>) => result,
        { buildRequestIdentity },
      );
      await record({ ...request, text: { format } });

      const replayer = createCassette({ cassetteFilePath, mode: "replay" });
      const provider = vi.fn(async (_params: Record<string, unknown>) => {
        throw new Error("Provider must not run during replay");
      });
      const replay = replayer.wrapAsyncFunction(
        "openai.responses.create",
        provider,
        { buildRequestIdentity },
      );
      await expect(
        replay({ ...request, text: { format: { type: "json_object" } } }),
      ).rejects.toThrow(/Cassette miss/);
      await expect(
        replay({ ...request, text: { format: { ...format, strict: false } } }),
      ).rejects.toThrow(/Cassette miss/);
      await expect(
        replay({
          ...request,
          text: {
            format: { ...format, schema: { ...format.schema, required: [] } },
          },
        }),
      ).rejects.toThrow(/Cassette miss/);

      const reorderedFormat = {
        schema: {
          additionalProperties: false,
          required: ["value"],
          properties: { value: { enum: ["ok", "pending"], type: "string" } },
          type: "object",
        },
        strict: true,
        description: "A synthetic result",
        name: "result",
        type: "json_schema",
      };
      await expect(
        replay({ ...request, text: { format: reorderedFormat } }),
      ).resolves.toEqual(result);
      expect(provider).not.toHaveBeenCalled();
      expect(replayer.getSessionStats()).toMatchObject({
        calls_recorded: 0,
        replay_hits: 1,
        replay_misses: 3,
      });
    });

    it("preserves schema constraints on a property named __proto__ when hashing", async () => {
      const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
      const cassetteFilePath = join(cassetteFolderPath, "schema-keys.jsonl");
      const withPropertyType = (type: string) => ({
        ...request,
        text: {
          format: {
            ...format,
            schema: {
              ...format.schema,
              properties: { ["__proto__"]: { type } }, // ubs:ignore -- Computed own key in a synthetic schema, not a prototype write.
              required: ["__proto__"], // ubs:ignore -- Inert schema field name in a string array.
            },
          },
        },
      });
      const recorder = createCassette({ cassetteFilePath, mode: "record" });
      const record = recorder.wrapAsyncFunction(
        "openai.responses.create",
        async (_params: Record<string, unknown>) => ({
          output_text: '{"__proto__":"ok"}',
        }),
        { buildRequestIdentity },
      );
      const result = await record(withPropertyType("string"));

      const replayer = createCassette({ cassetteFilePath, mode: "replay" });
      const replay = replayer.wrapAsyncFunction(
        "openai.responses.create",
        async (_params: Record<string, unknown>) => {
          throw new Error("Provider must not run during replay");
        },
        { buildRequestIdentity },
      );
      await expect(replay(withPropertyType("number"))).rejects.toThrow(
        /Cassette miss/,
      );
      await expect(replay(withPropertyType("string"))).resolves.toEqual(result);
    });

    it.each([
      ["absent text", undefined],
      ["null text", null],
      ["empty text", {}],
      ["undefined format", { format: undefined }],
    ])(
      "preserves legacy hashes with %s and misses explicit formats",
      async (_label, text) => {
        const cassetteFolderPath = mkdtempSync(
          join(tmpdir(), "agent-cassette-"),
        );
        const cassetteFilePath = join(cassetteFolderPath, "legacy.jsonl");
        // Captured from f977ee7 for the synthetic request above, in both profiles.
        const entry = {
          cassette_version: 1,
          call_name: "openai.responses.create",
          request_hash:
            "6093252cc9ca4f64534b67e9d58ea11df7fde05f1bc319655be8a395bdf05a98",
          recorded_at_ms: 0,
          result: { output_text: "legacy result" },
        };
        writeFileSync(cassetteFilePath, `${JSON.stringify(entry)}\n`, "utf8");
        const replayer = createCassette({ cassetteFilePath, mode: "replay" });
        const replay = replayer.wrapAsyncFunction(
          entry.call_name,
          async (_params: Record<string, unknown>) => {
            throw new Error("Provider must not run during replay");
          },
          { buildRequestIdentity },
        );

        // Old identities omitted every format; never fall back to their unsafe key.
        for (const explicitFormat of [
          { type: "text" },
          { type: "json_object" },
          format,
        ]) {
          await expect(
            replay({ ...request, text: { format: explicitFormat } }),
          ).rejects.toThrow(/Cassette miss/);
        }
        await expect(replay({ ...request, text })).resolves.toEqual(
          entry.result,
        );
      },
    );
  },
);

it("keeps sampling preferences strict-only while defaulting to strict identity", () => {
  const request = {
    model: "synthetic-model",
    input: "Return a JSON result.",
    text: { format: { type: "json_object" } },
    temperature: 0,
  };
  const warmerRequest = { ...request, temperature: 1 };

  expect(createOpenAIResponsesRequestIdentity(request)).toEqual(
    createOpenAIResponsesRequestIdentity(request, { hashProfile: "strict" }),
  );
  expect(createOpenAIResponsesRequestIdentity(request)).not.toEqual(
    createOpenAIResponsesRequestIdentity(warmerRequest),
  );
  expect(
    createOpenAIResponsesRequestIdentity(request, { hashProfile: "lenient" }),
  ).toEqual(
    createOpenAIResponsesRequestIdentity(warmerRequest, {
      hashProfile: "lenient",
    }),
  );
});

describe("Agent Cassette v0", () => {
  it("records and replays a successful async function call", async () => {
    // Setup: Create a unique temp folder for this test run
    const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
    const cassetteFilePath = join(cassetteFolderPath, "success.jsonl");

    // 1. Record Phase
    const recorder = createCassette({ cassetteFilePath, mode: "record" });

    const recordedAdd = recorder.wrapAsyncFunction(
      "add",
      async (a: number, b: number) => a + b,
    );
    const recordedResult = await recordedAdd(2, 3);
    expect(recordedResult).toBe(5);

    // 2. Replay Phase
    const replayer = createCassette({ cassetteFilePath, mode: "replay" });
    const replayAdd = replayer.wrapAsyncFunction(
      "add",
      async (_a: number, _b: number) => {
        throw new Error("This should never run in replay mode");
      },
    );

    const replayedResult = await replayAdd(2, 3);
    expect(replayedResult).toBe(5);

    // 3. Stats Check
    const stats = replayer.getSessionStats();
    expect(stats.replay_hits).toBe(1);
    expect(stats.replay_misses).toBe(0);
  });

  it("records and replays thrown errors deterministically", async () => {
    const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
    const cassetteFilePath = join(cassetteFolderPath, "errors.jsonl");

    // 1. Record an error
    const recorder = createCassette({ cassetteFilePath, mode: "record" });

    const recordedFail = recorder.wrapAsyncFunction("fail", async () => {
      throw new Error("boom");
    });

    await expect(recordedFail()).rejects.toThrow("boom");

    const replayer = createCassette({ cassetteFilePath, mode: "replay" });

    const replayFail = replayer.wrapAsyncFunction("fail", async () => {
      throw new Error("This should never run in replay mode");
    });

    await expect(replayFail()).rejects.toThrow("boom");
  });

  it("replay misses are explicit and actionable", async () => {
    const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
    const cassetteFilePath = join(cassetteFolderPath, "empty.jsonl");
    writeFileSync(cassetteFilePath, "", "utf8");

    const replayer = createCassette({ cassetteFilePath, mode: "replay" });
    const fn = replayer.wrapAsyncFunction(
      "nope",
      async (_input: string) => "should not run",
    );
    await expect(fn("x")).rejects.toThrow(/Cassette miss/);
  });
});
