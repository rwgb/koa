---
written: 2026-06-23
branch: feature/web-console-and-hardening
tests: 910
tsc: clean
tip: b107b89
audit: docs/AUDIT-2026-06-23.md
---

## Where We Are

**2026-06-23 P0 remediation session**: All 9 P0 audit findings fully remediated as of 2026-06-23. SEC-001/002 security fixes applied, GAP-01–05 test coverage added, UX-001–003 error surfaces fixed. Branch sealed with commit b107b89.

**2026-06-23 audit session**: Full security + QA + UI/UX audit completed. 54 findings ranked P0/P1/P2 in `docs/AUDIT-2026-06-23.md`. 910 tests passing (was 843), 55.4% statement coverage.

**2026-06-23 session (earlier)**: Multi-instance integrations fully implemented and sealed (commit 91858b7). signingSecret masked, MULTI_INSTANCE_TYPES extended to gmail/google-calendar/slack/mcp_server, OAuth state carries integrationId, GmailPoller iterates all accounts, CalendarSync iterates all google-calendar instances, DB migration 11 adds source_integration_id to calendar_events, Slack webhook tries all connected secrets. Security fixes: integrationId regex-validated, KOA_WEB_TOKEN/KOA_HOME excluded from env dump, cwd removed from debug/info response.

**2026-06-22 session**: KOA_PUBLIC_URL implemented + deployed. `https://koa.tailf8d66c.ts.net` live via `tailscale serve`. SSH key auth set up (root@192.168.1.200). OAuth redirect_uri now correct.

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

### P1 Security
1. **SEC-003** — Slack response_url SSRF: validate URL against allowlist before fetching
2. **SEC-004** — Telegram sender allowlist: silent drop + unauthorized_inbound signal for unknown senders
3. **SEC-005** — bash tool cwd lock: jail working directory to project root
4. **SEC-006** — debug/info key leak: scrub API keys from debug/info log output
5. **SEC-007** — calendar OAuth error leak: sanitize OAuth error messages before surfacing to client
6. **SEC-010** — Rate limiting on /api/chat and SSE endpoints
7. **SEC-014** — openaiCompatibleBaseUrl SSRF: validate against SSRF blocklist before use
8. **SEC-015** — Twilio HMAC: use raw body + X-Forwarded-For awareness

### P1 QA
9. **GAP-06** — GmailPoller unit tests (0% coverage)
10. **GAP-07** — integrations/store atomic write tests
11. **GAP-08** — semanticCompact fallback tests
12. **GAP-09** — conversation export tests
13. **GAP-10** — PUT /config endpoint tests
14. **GAP-11** — writeMemoryEvent dedup logic tests
15. **GAP-12** — McpManager partial failure handling tests

### P1 UX
16. **UX-004 through UX-019** — Activity spinners, search nav, delegations errors, task creation errors, timestamps, notifications

### Deploy
17. **Deploy to LXC** — sync .env to LXC (192.168.1.200), restart koa service, verify DB migration 11 ran cleanly

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
