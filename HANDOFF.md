# HANDOFF.md

## Architect Summary
**Agent**: architect
**Last agent**: architect
**Next agent**: coder
**Status**: PASS

### Plan

A three-layer memory and agent coordination system was designed for Koa:

**Layer 1 — Working Memory** (`~/.koa/projects/<slug>-<hash>/`):
- PROJECT.md — Haiku-generated on first session from SpiderBrain context + codebase scan
- STATE.md — written at `finalize()` and on `/checkpoint` command; Haiku-generated summary of in-flight work
- `journal/YYYY-MM-DD.md` — daily session log appended at finalize
- BACKLOG.md — user-managed prioritized work items
- HANDOFF.md — inter-agent state tracker (this file, written by `dispatch_agent` tool)

**Layer 2 — SpiderBrain Auto-Molt**:
- `SpiderBrainClient.isStale()` checks synganglion.json mtime (>7 days = stale)
- `autoMolt()` fires molt.mjs in background; called fire-and-forget from `AgentLoop.initialize()`
- No blocking of chat startup

**Layer 3 — Engram Auto-Index**:
- `EngramClient.autoIndex()` checks if brain.db exists; fires `sync()` in background if absent
- Fire-and-forget from `AgentLoop.initialize()`

**Agent Coordination**:
- New `dispatch_agent` tool registered in `buildRegistry()`
- Allowlist: `architect | reviewer | debug | security-reviewer`
- Runs `claude --print` subprocess via execa (args array, no shell)
- Writes HANDOFF.md with RUNNING before exec, PASS/FAIL after

**Key architectural change**:
- `src/session/store.ts` is fully retired and deleted
- `SessionRecord` type removed from `types/index.ts`
- Working memory layer replaces all session tracking

### Key Decisions

- **MD5 via Node built-in `crypto`** — zero new npm deps; 8 hex chars sufficient for per-user uniqueness
- **Haiku for all LLM generation** — `claude-haiku-4-5-20251001` hardcoded in generators; minimizes cost per brief constraint
- **Atomic file writes** — `writeMarkdownFile` uses tmp + rename to prevent corrupt STATE.md on crash
- **`finalize()` awaits pending PROJECT.md gen with 10s timeout** — guarantees first-session doc is written; timeout prevents hang on slow molt
- **`dispatch_agent` uses execa args array** — consistent with all existing tool patterns; prevents arg injection
- **Agent allowlist validated before exec** — security boundary: Koa cannot be prompted to run arbitrary binaries
- **stderr-only logging for background tasks** — MCP mode owns stdout; stderr safe for all three frontends

### Tasks Generated

See TASKS.md for full breakdown:
- **Phase 1**: Project memory directory infrastructure (paths.ts, store.ts)
- **Phase 2**: PROJECT.md and STATE.md auto-generation (Haiku generators, AgentLoop.initialize changes, types)
- **Phase 3**: Journal and session finalization (finalize() rewrite, session/store.ts deletion)
- **Phase 4**: /checkpoint command (AgentLoop.checkpoint(), TUI handler, web handler)
- **Phase 5**: SpiderBrain auto-molt (isStale(), autoMolt(), background fire-and-forget)
- **Phase 6**: Agent coordination (dispatch_agent tool, HANDOFF writer helper)
- **Phase 7**: Engram auto-index (autoIndex() on EngramClient)
- **Phase 8**: Full test coverage (unit + integration, all new modules)
- **Phase 9**: Code review + security review of dispatch_agent
- **Phase 10**: Deprecation cleanup (session/store.ts deleted, README updated)
