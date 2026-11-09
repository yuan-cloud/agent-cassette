import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
