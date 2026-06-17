# ADR-0001: Per-Turn Retrieval for Episodic and Semantic Memory

## Status
Accepted

## Context
Koa injects memory context at session start — Engram brain, SpiderBrain masters, the 200-fact global store, and project STATE.md. This is static: the same context is available on every turn regardless of what the user is asking about.

Near-human memory doesn't work this way. Humans retrieve memories in response to the present moment — the current cue triggers relevant recall. The CP17 memory spec proposes RRF (vector + FTS) retrieval, which supports query-time lookup.

The question was whether to retrieve once at session start or on every turn.

## Decision
Episodic and semantic memory are retrieved per-turn, using the current user message as the retrieval query. Static injection at session start is retained only for structural context: STATE.md, SpiderBrain masters, and the global 200-fact store.

## Consequences
- A conversation about the homelab pulls homelab memories; a conversation about a recipe pulls food preferences. Retrieval is contextually appropriate.
- Per-turn retrieval adds latency (~150ms p95 budget per CP17 spec). This is acceptable given the recall quality improvement.
- The retrieval budget is ≤2KB injected context per turn to keep prompt size bounded.
- Session-start injection remains for structural context that is always relevant regardless of turn content.
