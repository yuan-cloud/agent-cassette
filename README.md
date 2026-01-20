# Agent Cassette 📼

**Record once → replay forever → deterministic tests for AI agents.**

Agent Cassette is a lightweight record-and-replay harness for agent workflows.
It captures structured **run traces** (LLM calls + tool calls) as they execute so you can replay behavior offline, write regression tests, and measure token/latency impact without hitting external APIs again.

> **v0:** Explicit wrapper–based (Stable & Type-Safe).
> **v1:** (Planned) Network interceptor plugin.

## Why this exists

Agent runs are often flaky and expensive:
- **Non-determinism:** The same prompt can produce different outputs.
- **Slow feedback:** Integration tests spend 90% of their time waiting on network calls.
- **Cost:** Repeated debugging burns tokens and money.

Cassette turns “I swear it failed yesterday” into a replayable, immutable artifact.

## Enterprise Use Case: Reliable Code Generation

**(See `examples/node-red-generator.ts`)**

This tool is designed for platforms like **FlowFuse** or **Node-RED** where AI agents generate executable code.
Agent Cassette provides a **Regression Testing Harness** that ensures:

1.  **Strict Schema Validation:** Agents must output valid JSON structures (e.g., correct `wires` and `coordinates`).
2.  **Semantic Safety:** If an agent generates unsafe code (e.g., missing `return msg`), the system detects it and swaps in a safe fallback.
3.  **Deterministic Replay:** We record a "Golden Run" of a complex flow generation. CI pipelines can replay this instantly (0 cost) to prove that model upgrades (e.g., GPT-4o -> GPT-5) don't break the JSON schema.

## Architecture

```mermaid
sequenceDiagram
    participant User
    participant Cassette
    participant OpenAI
    participant Runtime as FlowFuse/Runtime

    alt Record Mode (Golden Run)
        User->>Cassette: Call Agent
        Cassette->>OpenAI: Forward Request
        OpenAI-->>Cassette: Return Code
        Cassette->>Cassette: Validate Schema (FunctionCodeSchema)

        opt Validation Fails
            Cassette->>Cassette: Apply Fallback Code
            Note right of Cassette: "Schema Violation Detected"
        end

        Cassette->>Cassette: Save to JSONL
        Cassette->>Runtime: Execute Side Effect (Deploy)
        Runtime-->>Cassette: Return Status
    else Replay Mode (CI/Docker)
        User->>Cassette: Call Agent
        Cassette->>Cassette: Match Semantic Hash
        Cassette-->>User: Return Saved Response (0ms)
        Note right of Runtime: Side Effect SKIPPED <br/>(Safe for Production)
    end
    replay: Match semantic hash, return recorded result (Network is mocked).

passthrough: Call without recording.

auto: Replay if cassette exists, otherwise record.

Quickstart (Node-RED Enterprise Demo)
1. Install & Setup
npm install
# Create your local env file
cp .env.example .env
2. Record (The "Golden Run")
Requires OpenAI API Key. Captures the run trace to disk.
export OPENAI_API_KEY="sk-..."
npm run nodered:record
3. Replay (The "Regression Test")
No API Key required. Instant feedback.
unset OPENAI_API_KEY
npm run nodered:replay
(Notice the 0ms latency and 100% token savings)
4. Docker (Production Simulation)
Prove the code runs anywhere (no local dependencies).
docker build -t agent-cassette .
docker run agent-cassette
Development & Contribution
We use ESLint and Prettier to maintain high engineering standards.
# Run Unit Tests
npm test

# Check Code Quality
npm run lint
How it works (v0)
Cassette wraps async functions and records {request_identity → result} as JSONL (one JSON object per line). JSONL is append-friendly and crash-safe: if a run dies mid-flight, earlier lines remain valid.

Modes:

record: Call real function, validate result, append entry.

replay: Match semantic hash, return recorded result (Network is mocked).

passthrough: Call without recording.

auto: Replay if cassette exists, otherwise record.

Roadmap
v0: Explicit Wrappers (Current)
Architecture: Manual wrapping of specific functions.

Status: ✅ Stable, Docker-ready, Type-Safe.

Trade-off: High control, but requires code changes to integrate.

v1: Network Interception (Planned)
Goal: "Drop-in" recording without changing application code.

Strategy: Implement the Proxy Pattern using undici dispatchers or msw to intercept HTTP traffic at the network layer.

Benefit: Zero-touch integration for existing codebases.

v2: Observability Dashboard (Planned)
Goal: Visualize the "Drift."

Strategy: A Web UI to diff "Record" vs "Replay" traces.

Benefit: Deeply understand failures (e.g., "Prompt changed on line 4"). """
