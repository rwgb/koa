# Spec: API Cost Optimization

> Status: Backlog
> Added: 2026-05-31
> Trigger: API spend limit hit at $100/month on 16.8M tokens/week with 21% prompt cache hit rate

---

## Problem

Koa is burning API budget faster than necessary across three failure modes:

1. **Low prompt cache hit rate (21%)** — The system prompt is being re-sent without cache headers, meaning every turn pays full input token price. Should be 60%+.
2. **Uniform model selection** — Cheap tasks (routing decisions, classification, document generation, journal writes) use Sonnet. Haiku is 15x cheaper and sufficient for these.
3. **Aggressive context injection** — Layered memory (Engram + SpiderBrain + project markdown) injects tokens regardless of query relevance. Most turns don't need the full memory payload.

---

## Goals

- Reduce weekly token spend by ≥50% without degrading response quality for complex tasks
- Raise prompt cache hit rate to ≥60%
- No user-visible behavior changes

---

## Non-Goals

- Switching the primary conversational model (Sonnet stays for agent turns)
- Batching or async processing of user-facing chat
- Response quality degradation of any kind

---

## Phase 1: Prompt Caching Fixes

**Owner**: coder
**Estimated savings**: 40–60% of current spend (largest lever)

### 1.1 — Cache system prompt prefix

In `src/agent/loop.ts` `buildSystemPrompt()`, the static prefix (persona, capabilities, tool list) must be sent as the first `user` message content block with `cache_control: { type: "ephemeral" }`.

The Anthropic SDK requires cache breakpoints on the content block array, not on the message. The static prefix rarely changes — it qualifies as a cache anchor.

AC:
- System prompt prefix is wrapped in a content block with `cache_control`
- API response `usage.cache_read_input_tokens > 0` on second and subsequent turns of the same session
- No change to model behavior (content unchanged)

### 1.2 — Cache project memory blocks

In `buildSystemPrompt()`, the `<project_memory>` XML blocks (PROJECT.md, STATE.md, BACKLOG.md) are read once at session start and don't change mid-session. These must be injected as a second cache breakpoint after the persona prefix but before the dynamic per-turn context.

AC:
- Project memory blocks carry a second `cache_control` breakpoint
- SpiderBrain hot-file context (which DOES change per turn) is injected AFTER the cache breakpoints, not before
- `tsc --noEmit` passes

### 1.3 — Verify cache hit rate via logging

Add a `logUsage(usage: APIUsage)` helper in `src/agent/loop.ts` that logs to stderr on every turn:

```
[koa] tokens — input: 4210 | cached: 3800 (90%) | output: 312 | est_cost: $0.0004
```

AC:
- Log line appears on every agent turn (stderr only, not stdout — MCP safe)
- Cache percentage calculated as `cache_read_input_tokens / (input_tokens + cache_read_input_tokens) * 100`
- Zero-cost when cache not used (no divide-by-zero)

---

## Phase 2: Model Tiering

**Owner**: coder
**Estimated savings**: 20–30% of remaining spend after Phase 1

Introduce a `ModelTier` concept with three levels. Each internal LLM call selects the appropriate tier:

| Tier | Model | Use Cases |
|------|-------|-----------|
| `fast` | `claude-haiku-4-5-20251001` | Routing classification, document generation (PROJECT.md, STATE.md, journal), agent dispatch summary |
| `standard` | `claude-sonnet-4-6` | Default agent turns, tool synthesis, multi-step reasoning |
| `powerful` | `claude-opus-4-7` | Explicit user escalation only (future) |

### 2.1 — Add `ModelTier` type to `src/types/index.ts`

```ts
export type ModelTier = 'fast' | 'standard' | 'powerful';
export const MODEL_MAP: Record<ModelTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-6',
  powerful: 'claude-opus-4-7',
};
```

AC: `tsc --noEmit` passes; no existing callers broken (additive change).

### 2.2 — Audit and update internal LLM calls

Audit every `anthropic.messages.create()` call in `src/`. Any call that:
- Produces internal/non-user-facing output (STATE.md, PROJECT.md, journal, handoff summaries)
- Classifies or routes (smart routing classifier)
- Summarizes for context injection

...must be changed to `MODEL_MAP.fast`.

AC:
- `grep -r 'messages.create' src/` output reviewed and each call tagged with tier in a comment
- Generator files (`project-doc.ts`, `state-doc.ts`) confirmed to use Haiku (already specced; verify no regression)
- Smart routing classifier confirmed on Haiku

### 2.3 — Add `model` field to agent config

`AgentConfig` in `src/types/index.ts` gets an optional `model?: ModelTier` defaulting to `'standard'`. `AgentLoop` reads this to select the model for user-facing turns.

AC:
- `koa chat --model fast` routes all turns through Haiku (useful for dev/testing)
- Default behavior unchanged (Sonnet)

---

## Phase 3: Selective Context Injection

**Owner**: coder
**Estimated savings**: 10–20% (reduces input tokens per turn)

Currently all memory sources are injected on every turn. Most queries don't need SpiderBrain file-level detail or the full BACKLOG.md.

### 3.1 — Query-relevance gate for SpiderBrain context

Before injecting SpiderBrain hot-file context, run a cheap relevance check:

```ts
function isCodeQuery(message: string): boolean {
  const codeSignals = ['function', 'file', 'module', 'error', 'bug', 'src/', 'import', 'class', 'type'];
  return codeSignals.some(sig => message.toLowerCase().includes(sig));
}
```

Only inject SpiderBrain context when `isCodeQuery(userMessage)` returns true.

AC:
- "What's the weather?" does not inject SpiderBrain context
- "What does `buildSystemPrompt` do?" does inject SpiderBrain context
- Unit test covers both branches

### 3.2 — Lazy BACKLOG.md injection

BACKLOG.md (often long) is only injected when the user message contains planning-related signals: `task`, `backlog`, `plan`, `next`, `todo`, `priority`, `should we`, `what's left`.

AC:
- Ordinary chat turns do not carry BACKLOG content in system prompt
- `/checkpoint` and planning queries do carry it
- Unit test for the gate function

### 3.3 — Token budget logging

Extend `logUsage()` to also log which context blocks were injected:

```
[koa] context — spiderbrain: YES | backlog: NO | state: YES | handoff: NO
```

AC:
- Log appears alongside token log (same stderr line or adjacent)
- No production impact (stderr only)

---

## Phase 4: Local Response Cache (Optional, Lower Priority)

**Owner**: coder
**Estimated savings**: variable — high value for repeated homelab queries

For queries that are identical or near-identical (e.g. "check homelab status", "what's my task list"), cache the last response for up to 60 seconds. Avoids redundant API round-trips for dashboard/polling use cases.

### 4.1 — In-memory LRU cache

Add a `ResponseCache` class in `src/agent/cache.ts`:
- Key: SHA-256 of `systemPromptHash + userMessage`
- TTL: 60 seconds (configurable via `KOA_CACHE_TTL_SECONDS`)
- Max size: 50 entries
- On hit: return cached response immediately, log `[koa] cache HIT`
- On miss: normal API call, store result

AC:
- Cache hit returns response in <5ms
- Cache is per-process (not persisted across sessions)
- Cache is bypassed if `--no-cache` flag passed to `koa chat`
- Unit tests: hit/miss/eviction/TTL expiry

### 4.2 — Wire into AgentLoop.turn()

Before dispatching to the API, check `this.cache.get(cacheKey)`. If hit, emit the cached `content` blocks directly and skip the API call. Tool calls are never cached (tool results are side-effectful).

AC:
- Turns that invoke tools are never cache-eligible
- Non-tool turns are cache-eligible
- `tsc --noEmit` passes

---

## Acceptance Criteria (Overall)

- [ ] Prompt cache hit rate rises from 21% to ≥60% in a typical 10-turn session
- [ ] Weekly token spend drops by ≥40% at equivalent usage levels
- [ ] All internal LLM calls (non-user-facing) use Haiku
- [ ] No regression in response quality on existing test suite
- [ ] `npm test` passes with 0 failures, 0 lint errors, 0 typecheck errors
- [ ] Token/context log lines appear on every turn (stderr)

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Cache breakpoints on content blocks, not messages | Anthropic SDK requirement; message-level caching doesn't exist |
| Haiku for all internal generation | 15x cheaper; internal docs don't need Sonnet-level quality |
| Keyword-based relevance gate (not LLM classifier) | A classifier call to decide whether to inject context would cost more than it saves |
| In-memory response cache (not persistent) | Persistent cache adds disk I/O and invalidation complexity; 60s TTL is sufficient for polling use cases |
| Phase 1 first, Phase 2 second | Caching is the dominant cost lever; model selection is secondary |
