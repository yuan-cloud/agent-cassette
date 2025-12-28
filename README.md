# Agent Cassette 📼
**Record once → replay forever → deterministic tests for AI agents.**

Agent Cassette is a lightweight record-and-replay harness for agent workflows.  
It captures structured **run traces** (LLM calls + tool calls) as they execute so you can replay behavior offline, write regression tests, and measure token/latency impact without hitting external APIs again.

> v0 is explicit wrapper–based (no monkey-patching).  
> v1 may add an optional network interceptor plugin.

## Why this exists
Agent runs are often flaky and expensive:
- **Non-determinism:** the same prompt can produce different outputs.
- **Slow feedback:** integration tests spend most of their time waiting on network calls.
- **Cost:** repeated debugging burns tokens.

Cassette turns “I swear it failed yesterday” into a replayable artifact.

## How it works (v0)
Cassette wraps async functions and records `{request_identity → result}` as **JSONL** (one JSON object per line).  
JSONL is append-friendly and crash-safe: if a run dies mid-flight, earlier lines remain valid.

Modes:
- `record`: call the real function and append an entry
- `replay`: match by a semantic hash and return the recorded result (no network)
- `passthrough`: call without recording
- `auto`: replay if cassette exists, otherwise record

## Quickstart (OpenAI Responses API)

### Install:
```bash
npm install
```

### Record (requires API key)
```bash
export OPENAI_API_KEY="YOUR_KEY"
npm run demo:record
```

### Replay (no API key required)
```bash
unset OPENAI_API_KEY
npm run demo:replay
```

## Metrics
Cassette prints:
- replay hit rate
- tokens recorded
- tokens saved estimate

## Limitations (v0)
- Streaming responses are treated as complete responses (chunk timing not preserved).
- Replay matching depends on a stable request identity (semantic hash). If you change the prompt/model/tools, you should expect a miss.