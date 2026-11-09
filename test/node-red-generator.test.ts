import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCassette,
  createOpenAIResponsesRequestIdentity,
  type CassetteEntry,
} from "../src/index";

it("Node-RED replays both successful Responses recordings", async () => {
  const cassetteFilePath = fileURLToPath(
    new URL("../cassettes/node-red-flow.jsonl", import.meta.url),
  );
  const entries = readFileSync(cassetteFilePath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as CassetteEntry);
  const successfulResponses = entries.filter(
    (entry) =>
      entry.call_name === "openai.responses.create" &&
      !entry.error &&
      entry.result !== undefined,
  );
  expect(successfulResponses).toHaveLength(2);

  const replayer = createCassette({ cassetteFilePath, mode: "replay" });
  const provider = vi.fn(async (_params: Record<string, unknown>) => {
    throw new Error("Provider must not run during replay");
  });
  const replay = replayer.wrapAsyncFunction(
    "openai.responses.create",
    provider,
    {
      buildRequestIdentity: ([params]) =>
        createOpenAIResponsesRequestIdentity(params),
    },
  );
  for (const entry of successfulResponses) {
    const [request] = entry.args_preview as [Record<string, unknown>];
    await expect(replay(request)).resolves.toEqual(entry.result);
  }

  expect(provider).not.toHaveBeenCalled();
  expect(replayer.getSessionStats()).toMatchObject({
    calls_recorded: 0,
    calls_replayed: 2,
    replay_hits: 2,
    replay_misses: 0,
  });
});

it("Node-RED replay misses exit nonzero without recording or calling a provider", () => {
  const workingDirectory = mkdtempSync(
    join(tmpdir(), "agent-cassette-node-red-"),
  );
  const examplePath = fileURLToPath(
    new URL("../examples/node-red-generator.ts", import.meta.url),
  );
  const tsxLoader = createRequire(import.meta.url).resolve("tsx");
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, examplePath],
    {
      cwd: workingDirectory,
      env: { PATH: process.env.PATH, CASSETTE_MODE: "replay" },
      encoding: "utf8",
      timeout: 15_000,
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain(
    "Cassette miss: no entry for openai.responses.create::",
  );
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain("Success! Generated Flow Summary:");
  expect(existsSync(join(workingDirectory, "cassettes"))).toBe(false);
}, 20_000);
