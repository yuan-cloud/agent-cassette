import OpenAI from "openai";
import {
  createCassette,
  createOpenAIResponsesRequestIdentity,
  extractOpenAIUsageMeta,
} from "../src/index";

const cassetteMode =
  (process.env.CASSETTE_MODE as "record" | "replay" | "passthrough" | "auto") ??
  "record";

const cassette = createCassette({
  cassetteFilePath: "./cassettes/demo.jsonl",
  mode: cassetteMode,
});

let lazyOpenAIClient: OpenAI | undefined;
function getOpenAIClient(): OpenAI {
  if (!lazyOpenAIClient) {
    lazyOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return lazyOpenAIClient;
}

const responsesCreate = cassette.wrapAsyncFunction(
  "openai.responses.create",
  // Use 'unknown' or the specific type
  async (requestParams: OpenAI.Responses.ResponseCreateParams) =>
    getOpenAIClient().responses.create(requestParams),
  {
    // Cast to Record<string, unknown> to satisfy the helper
    buildRequestIdentity: ([requestParams]) => createOpenAIResponsesRequestIdentity(requestParams as unknown as Record<string, unknown>, { hashProfile: "strict" }),
    buildArgsPreview: ([requestParams]) => ({
      model: requestParams?.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input_preview: typeof (requestParams as any)?.input === "string" ? (requestParams as any).input.slice(0, 120) : (requestParams as any)?.input
    }),
    buildMeta: (response) => extractOpenAIUsageMeta(response)
  }
);

async function main() {
  const modelName = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await responsesCreate({
    model: modelName,
    input: [
      {
        role: "user",
        content:
          "Write a 2-sentence story about a unicorn debugging a flaky test.",
      },
    ],
    store: false,
  });

  console.log("mode:", cassetteMode);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log("output_text:", (response as any).output_text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log("usage:", (response as any).usage);

  const stats = cassette.getSessionStats();
  const replayHitRate =
    stats.calls_replayed === 0 ? 0 : stats.replay_hits / stats.calls_replayed;

  console.log("--- cassette stats ---");
  console.log("calls_recorded:", stats.calls_recorded);
  console.log("calls_replayed:", stats.calls_replayed);
  console.log("replay_hits:", stats.replay_hits);
  console.log("replay_misses:", stats.replay_misses);
  console.log("replay_hit_rate:", replayHitRate);
  console.log("tokens_recorded:", stats.total_tokens_recorded);
  console.log("tokens_saved_estimate:", stats.total_tokens_saved_estimate);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
