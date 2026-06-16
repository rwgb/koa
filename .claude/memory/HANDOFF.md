---
written: 2026-06-16
branch: feature/web-console-and-hardening
tests: 843
tsc: clean
tip: e2877d8 (+ session work: fix queue + CP27-A/B/E + CP27-C/D + CP29-C + Fix 6)
---

## Where We Are

Fix queue cleared. CP27 write path (SQLite schema + typed events) committed. CP29 scheduler (priority lanes) committed. 7 fixes applied (compactAfterTurns, synthesizeSpeech, MODEL_CONTEXT_WINDOWS, OAuth TTL, browserEnabled, graceful drain, Slack cap). v1.0.0 track solid; CP27 retrieval and CP29 event bus deferred to v1.1.

### What Was Done This Session

- **Fix queue cleared** (7 fixes): compactAfterTurns removed, synthesizeSpeech dead export removed, MODEL_CONTEXT_WINDOWS keys aligned, OAuth nonce TTL (10min) + prune (5min), browserEnabled runtime check on tool registration, graceful SIGTERM/SIGINT drain (30s budget), Slack inbound text capped at 2000 chars
- **CP27-A: SQLite schema** — src/memory/schema.ts (tables: memory, versions) + src/memory/db.ts (init, version mgmt); better-sqlite3 added to package.json
- **CP27-B: Typed write path** — src/memory/events.ts (8 event types: correction, preference, resolved, assertion, decision, failure, standing-order, boundary); dedup logic for assertion/standing-order
- **CP27-E: Agent tool** — write_memory_event registered in buildRegistry() with required fields (type, data) + optional (event_id, relates_to)
- **CP29-C: Priority scheduler** — src/agent/scheduler.ts (TurnScheduler class, priority queue, user>autonomous); replaces isBusy flag with proper lane isolation
- **CP27-C: Memory retrieval** — src/memory/retrieval.ts (BM25/RRF retrieval from SQLite FTS5; queryDb(), rrfMerge(), queryMemories(), buildEpisodicMemoryInjection())
- **CP27-D: Prompt injection** — loop.ts buildSystemBlocks() wired to inject per-turn episodic memory into Block 3 (dynamic, no cache)

### Key Decisions Made

| Area | Decision |
|---|---|
| CP27 shipping | Write path only (schema + events + agent tool); retrieval (C/D) deferred to v1.1 |
| CP29 shipping | Scheduler + priority lanes only (user > autonomous); event bus deferred to v1.1 |
| SQLite API | better-sqlite3 (sync) chosen over sqlite3/bun:sqlite; fits agent loop (writes in-turn, no race windows) |
| Graceful shutdown | SIGTERM/SIGINT drain: close → drain → finalize → exit (30s budget); no interruption of active turn |
| OAuth nonce TTL | 10-minute TTL with 5-minute prune interval; prevents unbounded growth while preserving replay safety |
| Browser tool gating | `browserEnabled` checked at tool registration time, not just config; prevents stale tool availability |
| Slack message length | Cap at 2000 chars before loop.turn(); prevents buffer overflow while preserving semantic content |
| Memory retrieval | Per-turn RRF for episodic/semantic; static for structural (deferred to v1.1) |
| Event bus | `namespace.verb` + prefix wildcards + `action_type` dispatch (deferred to v1.1) |
| Providers | Hybrid: named Anthropic/ClaudeCode/Google + generic OpenAI-compatible (CP28) |
| Session isolation | Priority lanes replace `isBusy` flag (scheduler owns decision, not turn handler) |
| SSE reconnection | Heartbeat + backoff + `streamId` resume |
| MCP | stdio first; `trusted: false` default for all MCP results |
| Telegram security | Sender allowlist; silent drop + `unauthorized_inbound` signal |
| SSE auth | Token to `Authorization` header; no more `?token=` |
| Self-healing | Unilateral within process; approval gate for external |
| Self-extending | Draft → approval → register; never auto-registers |
| Email outbound | Wired into dispatchToChannel |

## Active Branch

`feature/web-console-and-hardening` — all pushed.

## What's Next (Prioritized)

1. **Tag v1.0.0 + release notes** — cut release after hardening passes QA

## Don't Restart

- `undici@8.4.1` incompatible with Node.js 20 — do not re-add
- Ollama removed from routing (too slow); re-enable via `KOA_PROVIDER=auto` when VM gets more resources
- Tailscale TLS: requires paid plan
- `CLAUDE_CODE_TMPDIR=~/.claude/tmp` — set in shell profile to fix ENOSPC

## Completed Checkpoints

| CP | Label | Status |
|----|-------|--------|
| CP0–CP22 | (see DEVLOG) | done |
| CP23 | Production routing fix | done |
| CP24 | Optional browser TTS + voice picker | done |
| CP25 | ElevenLabs server-side TTS | done |
| CP26 | Web UI settings completeness + debug console | done |
| — | Matt Pocock engineering skills installed + koa configured | done |
| — | Architecture grill: CONTEXT.md + 6 ADRs + cleanup | done |
| Fix queue + CP27-A/B/E + CP29-C + Fix 6 | v1.0.0 track | done |
| CP27-C/D | Memory retrieval (BM25/RRF) + system prompt injection | done |
| CP29-A/B | Event bus: namespace.verb + action_type dispatch | done |
| CP28 | Provider expansion: OpenAI-compatible + Google Gemini + web UI | done |
| — | mattpocock/skills: productivity + misc buckets installed (9 skills) | done |
| CP30 | MCP over stdio | done |
| — | Ansible hardening role + playbook refactor | done |
