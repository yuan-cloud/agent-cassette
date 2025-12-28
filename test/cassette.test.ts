import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCassette } from "../src/cassette";

describe("Agent Cassette v0", () => {
  it("records and replays a successful async function call", async () => {
    const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
    const cassetteFilePath = join(cassetteFolderPath, "success.jsonl");

    const recorder = createCassette({ cassetteFilePath, mode: "record" });

    const recordedAdd = recorder.wrapAsyncFunction("add", async (a: number, b: number) => a + b);
    const recordedResult = await recordedAdd(2, 3);
    expect(recordedResult).toBe(5);

    const replayer = createCassette({ cassetteFilePath, mode: "replay" });
    const replayAdd = replayer.wrapAsyncFunction("add", async (_a: number, _b: number) => {
      throw new Error("This should never run in replay mode");
    });
    

    const replayedResult = await replayAdd(2, 3);
    expect(replayedResult).toBe(5);

    const stats = replayer.getSessionStats();
    expect(stats.replay_hits).toBe(1);
    expect(stats.replay_misses).toBe(0);
  });

  it("records and replays thrown errors deterministically", async () => {
    const cassetteFolderPath = mkdtempSync(join(tmpdir(), "agent-cassette-"));
    const cassetteFilePath = join(cassetteFolderPath, "errors.jsonl");

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
    const fn = replayer.wrapAsyncFunction("nope", async (_input: string) => "should not run");
    await expect(fn("x")).rejects.toThrow(/Cassette miss/);
  });
});
