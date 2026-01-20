import OpenAI from "openai";
import {
  createCassette,
  createOpenAIResponsesRequestIdentity,
  extractOpenAIUsageMeta,
} from "../src/index";

// Define a helper type for the params
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams;

// --- Domain Types ---

interface NodeRedNode {
  id: string;
  type: string;
  x?: number;
  y?: number;
  wires?: string[][];
  name?: string;
  func?: string;
  [key: string]: unknown;
}

interface DeploymentResult {
  deploymentId: string;
  status: "active" | "deployed_with_warnings";
  nodes: number;
}

interface FlowGenerationResult {
  flow: NodeRedNode[];
  deployment: DeploymentResult;
}

// --- Configuration ---

const cassetteMode =
  (process.env.CASSETTE_MODE as "record" | "replay" | "passthrough" | "auto") ??
  "record";
const cassette = createCassette({
  cassetteFilePath: "./cassettes/node-red-flow.jsonl",
  mode: cassetteMode,
});

let lazyOpenAIClient: OpenAI | undefined;
function getOpenAIClient(): OpenAI {
  if (!lazyOpenAIClient)
    lazyOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return lazyOpenAIClient;
}

// --- Wrapper Definitions ---

const safeCreate = cassette.wrapAsyncFunction(
  "openai.responses.create",
  async (params: ResponseCreateParams) =>
    getOpenAIClient().responses.create(params),
  {
    buildRequestIdentity: ([params]) =>
      createOpenAIResponsesRequestIdentity(params as Record<string, unknown>),
    buildMeta: (res) => extractOpenAIUsageMeta(res),
  },
);

/**
 * Validation Logic for Node-RED Function Nodes.
 * Ensures generated code adheres to runtime requirements (e.g. returning msg).
 */
const FunctionCodeSchema = {
  validate(code: string): boolean {
    if (!code || code.trim().length === 0) return false;
    if (!code.includes("msg.payload")) return false;
    if (!code.includes("return msg")) return false;
    return true;
  },
  getFallback(): string {
    return "msg.payload = 'Fallback: AI generation failed validation';\nreturn msg;";
  },
};

/**
 * Simulates a deployment to the runtime environment.
 * Includes a validation step to sanitize AI-generated code before activation.
 */
async function validateAndDeployFlow(
  flowJson: NodeRedNode[],
): Promise<DeploymentResult> {
  if (!Array.isArray(flowJson)) {
    throw new Error(`Invalid Flow: Expected array, got ${typeof flowJson}`);
  }

  console.log(
    `[System] Validating ${flowJson.length} nodes against FunctionCodeSchema...`,
  );

  let validationIssues = 0;

  const sanitizedFlow = flowJson.map((node) => {
    if (node.type === "function") {
      const code = node.func || "";
      const isValid = FunctionCodeSchema.validate(code);

      if (!isValid) {
        console.warn(
          `[Validation Warning] Node ${node.id} failed schema. Applying fallback.`,
        );
        validationIssues++;
        return {
          ...node,
          name: (node.name || "Function") + " (Fallback)",
          func: FunctionCodeSchema.getFallback(),
        };
      }
    }
    return node;
  });

  if (validationIssues > 0) {
    console.log(
      `[Metrics] ⚠️ Validation failed for ${validationIssues} nodes. Fallback applied.`,
    );
  } else {
    console.log("[Metrics] ✅ All nodes passed validation.");
  }

  console.log("[System] Deploying to runtime...");
  return {
    deploymentId: "dep_" + Math.random().toString(36).substring(7),
    status: validationIssues > 0 ? "deployed_with_warnings" : "active",
    nodes: sanitizedFlow.length,
  };
}

const safeDeploy = cassette.wrapAsyncFunction(
  "flowfuse.deploy",
  validateAndDeployFlow,
  {},
);

// --- Agent Logic ---

async function generateNodeRedFlow(
  userRequest: string,
): Promise<FlowGenerationResult> {
  console.log(`\n--- Agent: Generating flow for "${userRequest}" ---`);

  const response = await safeCreate({
    model: "gpt-4o-2024-08-06",
    input: [
      {
        role: "system",
        content: `You are an expert Node-RED Architect. 
                Output a JSON object with a key named "flow" containing the array of nodes.
                The flow must include coordinates (x, y) and wires.
                If you create a function node, ensure it handles msg.payload and returns msg.`,
      },
      { role: "user", content: userRequest },
    ],
    text: { format: { type: "json_object" } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawResponse = response as any;
  let content = "";

  if (rawResponse.output_text) {
    content = rawResponse.output_text;
  } else if (rawResponse.output) {
    content =
      rawResponse.output.find(
        (i: { type: string; content: { text: string }[] }) =>
          i.type === "message",
      )?.content[0]?.text || "";
  }

  const flowData = JSON.parse(content);

  // Robust extraction: Check primary keys, then fallback to recursive search or wrapping
  let flowArray: unknown = flowData.flow || flowData.nodes;

  if (!Array.isArray(flowArray)) {
    const potentialArray = Object.values(flowData).find((val) =>
      Array.isArray(val),
    );
    if (potentialArray) {
      flowArray = potentialArray;
    } else {
      flowArray = flowData.id ? [flowData] : [];
    }
  }

  // FIX: Cast to strict type here instead of 'as any[]' in the function call
  const typedFlow = flowArray as NodeRedNode[];
  const deployResult = await safeDeploy(typedFlow);

  return { flow: typedFlow, deployment: deployResult };
}

// --- Main Execution ---

async function main() {
  // Requesting a function node specifically triggers the validation logic
  const result = await generateNodeRedFlow(
    "Create a function node that converts payload to uppercase",
  );

  console.log("\nSuccess! Generated Flow Summary:");
  result.flow.forEach((node) => {
    console.log(
      `- [${node.type}] ID: ${node.id} (Wires: ${node.wires?.length ?? 0})`,
    );
  });
  console.log("Deployment Status:", result.deployment.status);

  const stats = cassette.getSessionStats();
  console.log(
    `\n[Cassette Stats] Mode: ${stats.mode} | Tokens Saved: ${stats.total_tokens_saved_estimate}`,
  );
}

main().catch(console.error);