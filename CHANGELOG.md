# Changelog

All notable changes to Koa are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [1.0.0] — 2026-06-16

First stable release. Covers the full CP0–CP30 arc: from the initial agent loop through layered memory, multi-provider routing, MCP, event bus, voice, web console hardening, and Ansible infrastructure automation.

### Added

**Memory system (CP27)**
- SQLite-backed episodic memory: `src/memory/schema.ts` (tables: `memory`, `versions`), `src/memory/db.ts` (sync init + version management via `better-sqlite3`)
- Typed write path: 8 event types (`correction`, `preference`, `resolved`, `assertion`, `decision`, `failure`, `standing-order`, `boundary`); dedup logic for idempotent assertion and standing-order events
- BM25/RRF retrieval (`src/memory/retrieval.ts`): FTS5-backed `queryDb()`, `rrfMerge()`, `queryMemories()`, `buildEpisodicMemoryInjection()`
- Per-turn episodic memory injection into system prompt Block 3 (dynamic, no cache)
- `write_memory_event` agent tool registered in `buildRegistry()` with required `type`/`data` fields

**Event bus (CP29)**
- `namespace.verb` bus with prefix-wildcard subscriptions and `action_type` dispatch
- Priority scheduler (`src/agent/scheduler.ts`): `TurnScheduler` class with `user` > `autonomous` lane isolation; replaces the coarse `isBusy` flag

**Provider expansion (CP28)**
- Generic OpenAI-compatible provider (`src/agent/providers/openai_compatible.ts`): any `base_url` + `api_key` pair works
- Google Gemini provider (`src/agent/providers/google.ts`)
- Provider picker in web console Settings page

**MCP over stdio (CP30)**
- MCP client (`src/agent/mcp/client.ts`) and manager (`src/agent/mcp/manager.ts`)
- `trusted: false` default for all MCP tool results; stdio-first transport

**Voice (CP24/CP25)**
- Optional browser TTS with voice picker in the chat header (`web/src/hooks/useSpeech.ts`)
- ElevenLabs server-side TTS provider; `none` provider with OS-aware default for Linux

**Web console (CP26)**
- Debug console page (`web/src/pages/DebugConsolePage.tsx`) with server-sent log stream
- Settings page completeness: voice, provider, MCP, GitHub, and TTS config all editable in-browser

**Infrastructure**
- Shared Ansible hardening role extracted; playbooks cover both Koa LXC and Ollama VM
- `koa update` — self-update with automatic rollback (CP18)
- Multi-instance GitHub integration with per-repo credential resolution (CP19)
- ClaudeCode provider fallback on Anthropic 429/quota exhaustion (CP16)
- Engram signal collector and cross-repo tools (CP15)
- Token-budget context compaction; `koa doctor --fix`; per-project `budget_usd` guards (CP17)

### Changed
- SSE auth: token moved to `Authorization` header (no more `?token=` in URLs)
- Production routing: `/api/*` proxied correctly; hot-reload preserved in dev (CP23)
- Major dependency refresh: `@anthropic-ai/sdk` 0.104, `zod` 4, `commander` 15, `ink` 7, `react` 19, `better-sqlite3` 12
- Web console on the Obsidian Pro theme

### Fixed
- `compactAfterTurns` removed (was resetting context incorrectly)
- Dead `synthesizeSpeech` export removed from TTS module
- `MODEL_CONTEXT_WINDOWS` keys aligned with SDK model IDs
- OAuth nonce TTL raised to 10 min with 5-min prune interval (prevents unbounded growth)
- `browserEnabled` checked at tool-registration time, not just config load
- SIGTERM/SIGINT graceful drain: close → drain → finalize → exit with 30 s budget
- Slack inbound text capped at 2000 chars before agent loop entry
- `scripts/checkpoint.sh` ntfy topic extraction on macOS (GNU-only `grep -P` replaced)

### Security
- Audit-verified: route authentication coverage, secret masking, SSRF validation on configurable URLs, sandbox isolation
- Telegram sender allowlist: silent drop + `unauthorized_inbound` signal on unknown senders
- Symlink traversal guard in cross-repo tools
- `trusted: false` enforced on all MCP tool results
- Documented accepted risks: updater trusts configured upstream (no commit signature verification); ntfy topic acts as a bearer-style credential

## [0.3.0] — CP13 end-of-arc

- Security hardening arc: SSRF fixes (including IPv6), `koa setup` wizard, ntfy parameterisation, repo sanitisation and template files, lint/test cleanup (627 tests)
- ClaudeCodeProvider with automatic routing; ntfy topic validation (CP14)

## [0.2.0]

- Web console (admin UI), context compression, channels (Slack/Gmail), voice (TTS/ElevenLabs/Whisper), iOS + watchOS companion apps, GitHub integration, calendar/email, plugin SDK, sandboxed execution, Playwright browser automation, Ollama provider, homelab deployment scaffolding (CP7–CP12g)

## [0.1.0]

- Initial CLI: Engram-aware Claude agent loop with TUI, layered memory (Engram + SpiderBrain + project markdown), specialist agent dispatch
