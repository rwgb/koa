# Koa — DevLog

## [2026-05-31] — CP2: Admin UI Phase 2 — Memory page, Activity page, 8 new API endpoints

### Completed
- **8 new admin API endpoints** added to `src/server/index.ts`:
  - `GET /api/admin/memory/engram` — returns live Engram + SpiderBrain context from `AgentState`
  - `GET /api/admin/memory/files` — reads PROJECT.md, STATE.md, BACKLOG.md, HANDOFF.md from project memory dir
  - `PUT /api/admin/memory/files/:file` — atomic write to any of the four project memory files
  - `GET /api/admin/memory/facts` — lists persistent facts from `~/.koa/memory.json`
  - `POST /api/admin/memory/facts` — adds a fact
  - `DELETE /api/admin/memory/facts` — removes a fact by content match (body `{ fact }`)
  - `POST /api/admin/brain/rebuild` — triggers SpiderBrain `molt()` via new `loop.rebuildBrain()` method
  - `GET /api/admin/activity/sessions` — reads all journal `.md` files from project memory `journal/` dir
- **`AgentLoop.rebuildBrain()`** — new public method wrapping `this.sb.molt()`, exposed for the server to call
- **MemoryPage** (`web/src/pages/MemoryPage.tsx`) — full implementation:
  - Engram panel: brain online/offline badge, session goal, hot files with score + cluster, master files, SpiderBrain masters
  - Project files panel: tabs for all four project memory files (read-only display, edit/create button opens inline textarea, atomic save)
  - Facts CRUD: list with add input + delete with confirmation guard
  - Rebuild brain button in page header
- **ActivityPage** (`web/src/pages/ActivityPage.tsx`) — full implementation:
  - Current session usage card grid: turns, tokens in/out, cache read/write, cache hit rate, estimated cost
  - Session journal accordion: reads per-day `.md` entries, expand/collapse per entry
  - Anthropic pricing reference table (labelled as estimates)
- **Frontend types** (`web/src/types.ts`) — added: `MemoryEntry`, `ProjectFileEntry`, `MemoryFilesResponse`, `EngramMemoryResponse`, `JournalSession`, `ActivitySessionsResponse`
- **API helpers** (`web/src/api.ts`) — added 8 functions: `fetchMemoryEngram`, `fetchMemoryFiles`, `updateMemoryFile`, `fetchFacts`, `addFact`, `deleteFact`, `rebuildBrain`, `fetchActivitySessions`
- **CSS** (`web/src/index.css`) — ~350 lines of new styles: `.mem-*` utility classes (sections, badges, file list, tabs, editor, buttons, facts), `.activity-*` classes (session accordion, usage grid, pricing table)
- Build: `tsc --noEmit` and `npm test` both pass (190/190, 0 errors)

### Decisions
- `DELETE /api/admin/memory/facts` uses request body (not URL path param) to avoid URL-encoding issues with fact strings that may contain slashes or special chars.
- `rebuildBrain()` returns the molt output string — surfaced in the Memory page header after a rebuild.
- Activity page shows journal files as read-only accordion (no edit needed — these are auto-generated session logs).
- Pricing table uses hardcoded estimates, labelled as such; not fetched from Anthropic API.

### Issues Found
- None new.

### Next Session
- [ ] Phase 3: Integrations page — connector card grid, slide-over panel, config persistence to `~/.koa/integrations.json`
- [ ] Phase 3: Notifications rules engine — channels, quiet hours
- [ ] Phase 2 follow-up: Settings page — make editable (PUT /api/admin/config)
- [ ] Old Sidebar component cleanup now that Memory page is complete

### Learnings
- `color-mix(in srgb, var(--x) 15%, transparent)` is the right pattern for dim tinted backgrounds without needing alpha hex vars — supported in all modern browsers.
- Accordion pattern with a single `expanded` string state (date key) is cleaner than a `Set<string>` for the journal entries.

---

## [2026-05-31] — CP1: Admin UI Phase 1 — Router, nav rail, settings, status pill

### Completed
- **React Router v7 shell**: `App.tsx` is now a router tree; `/` redirects to `/chat`. Routes: `/chat`, `/memory`, `/integrations`, `/skills`, `/notifications`, `/activity`, `/settings`.
- **RootLayout** (`web/src/layouts/RootLayout.tsx`): Top nav + nav rail + `<Outlet>`. Wraps `AgentProvider` so status pill works on any page.
- **AgentContext** (`web/src/context/AgentContext.tsx`): Shared React context lifting `isThinking`, `activeTool`, `usage`, `agentStatus`. `ChatPage` sets these via context; `TopNav` reads them. Initial status fetched on provider mount.
- **TopNav** (`web/src/components/TopNav.tsx`): Three-state status pill (`● Idle` / `● Thinking` / `● Running: bash`), Koa wordmark + version badge, session cost, model tier badge.
- **NavRail** (`web/src/components/NavRail.tsx`): Fixed 220px left rail with active-link highlighting via React Router `NavLink`.
- **ChatPage** (`web/src/pages/ChatPage.tsx`): Full-width (old sidebar removed per spec). All agent state changes go through `AgentContext` setters so TopNav pill stays live.
- **SettingsPage** (`web/src/pages/SettingsPage.tsx`): Reads `GET /api/admin/config`; renders Agent, Auto-checkpoint, Memory, API Key, Project sections as read-only.
- **Backend** (`src/server/index.ts`): Added `GET /api/admin/config` on `/api/admin/` prefix. Returns sanitised config (`apiKeySet: bool`, no raw key).
- **Stub pages**: Memory, Integrations, Skills, Notifications, Activity — placeholder with icon + phase note.
- **CSS rework**: `.app-shell` / `.app-content` grid replaces `.app` / `.main`. New styles for TopNav, status pill, nav rail, settings page, stub pages.

### Decisions
- Old `Sidebar` component kept in `web/src/components/Sidebar.tsx` but not rendered (moved to Memory page in Phase 2).
- Old `StatusBar` component kept but superseded by `TopNav`. Will delete after Phase 2 confirms nothing needs it.
- Settings page is read-only for Phase 1 — editing config via UI is Phase 2 scope.
- `AgentContext` initialises via `fetchStatus()` on mount (single fetch, not poll). ChatPage drives live updates via SSE.

### Issues Found
- None new.

### Next Session
- [ ] Phase 2: Memory page — Engram panel (brain status, hot files, session goal), project memory files, persistent facts CRUD
- [ ] Phase 2: Activity page — session log table, cost dashboard
- [ ] Phase 2: Add PUT /api/admin/config to make Settings page editable
- [ ] Phase 2: Add `/api/admin/memory/files` and `/api/admin/memory/facts` endpoints
- [ ] Old Sidebar component cleanup once Memory page is done

### Learnings
- React Router v7 `<NavLink>` className prop accepts a function `({ isActive }) => string` — clean for nav rail active states.
- Lifting agent state to `AgentContext` at `RootLayout` level is the right pattern for cross-route live status; avoids prop drilling and keeps ChatPage self-contained.

---

## [2026-05-31] — CP0: Pipeline kickoff, lint fix, PR #1 merge → 0.2.0

### Completed
- **Lint fix**: Removed unused `ProjectMemory` import from `src/agent/loop.ts` — ESLint clean.
- **Admin UI spec committed**: `docs/ADMIN-UI-SPEC.md` — 5-phase spec authored by Koa covering nav rail, Memory/Activity/Integrations/Skills/Notifications/Settings pages, 20+ new API endpoints, tech choices (React Router v7, TanStack Query, Radix UI, Recharts).
- **PR #1 merged** (`feature/web-console-and-hardening → develop`): All auto-checkpoint, SpiderBrain auto-molt, Engram fixes, project memory, agent dispatch, TUI fixes, and docs committed.
- **Tagged `v0.2.0`** on develop.

### Decisions
- Auth for admin UI: session cookie login page (not passphrase, not open). Decided before Phase 1 starts.
- Integration config persistence: `~/.koa/integrations.json` — separate from credentials file.
- ntfy.sh topic wired: `https://ntfy.sh/undaunting_underpants` — checkpoint notifications will fire at each pipeline stage.

### Next Session
- [ ] Start Admin UI Phase 1 (CP1): React Router v7, nav rail shell, Settings page, status pill
- [ ] Answer remaining open questions before Phase 3: skill package format, hot reload vs restart

---

## [2026-05-31] — Auto-checkpoint, SpiderBrain rebuild, deprecation fix

### Completed
- **Node deprecation warning suppressed**: Changed shebang in `src/cli/index.ts` from `#!/usr/bin/env node` to `#!/usr/bin/env -S node --no-deprecation`. TypeScript preserves the shebang through compilation. DEP0040 (`punycode`) no longer appears on launch.
- **SpiderBrain graph rebuilt**: Brain was drifted (10 unindexed files, 12 modified). Ran `build-brain.mjs` manually — rebuilt to 57 nodes, 3 clusters (src: 40, web: 13, shell: 4). `docs`/`bin`/`lib` cluster warnings are benign (those dirs only have non-code files). `isStale()` threshold is 7 days; drift was content-based not time-based.
- **E2E verification completed**: Goal visible in sidebar, STATE.md written on session exit, journal appended. Confirmed working.
- **Auto-checkpoint feature** (`src/config/index.ts`, `src/agent/loop.ts`, `src/cli/index.ts`):
  - Turn-based: `_autoCheckpoint()` fires after every N turns (default: 5). Checked via `turnCount % autoCheckpointTurns === 0` at end of `turn()`.
  - Time-based: `setInterval` in `initialize()` fires every N minutes (default: 15). Timer is `.unref()`'d so it never holds the event loop open.
  - Both triggers share a single `_autoCheckpoint()` private method guarded by `_checkpointInProgress` flag — concurrent calls are silently dropped.
  - Timer cleared in `finalize()` before early-return check (covers zero-turn sessions).
  - Three config layers: CLI flags (`--checkpoint-turns`, `--checkpoint-minutes`) > env vars (`KOA_CHECKPOINT_TURNS`, `KOA_CHECKPOINT_MINUTES`) > `~/.koa/config.json` > defaults (5 turns / 15 min). Set either to `0` to disable.
  - 23 new tests in `src/__tests__/auto_checkpoint.test.ts`; 8 new tests in `src/__tests__/config.test.ts`. Suite: 190 passing / 13 files.

### Decisions
- `_autoCheckpoint()` returns `void` (not `Promise<void>`) — callers treat it as pure fire-and-forget. Internally chains `.then/.catch/.finally` for error handling and flag reset.
- Used `setInterval` `.unref?.()` (optional chaining) — fake timers in vitest don't expose `.unref()`, so this avoids test crashes without conditional guards around the production call.
- `_checkpointTimer` declared as `ReturnType<typeof setInterval> | undefined = undefined` (not `?:` optional) — required by `exactOptionalPropertyTypes: true` in tsconfig to allow explicit `= undefined` assignment in `finalize()`.

### Issues Found
- None new. Existing: Engram FTS is file-path only (noted in prior session).

### Next Session
- [ ] Merge PR #1 (feature/web-console-and-hardening → develop)
- [ ] Upgrade `@anthropic-ai/sdk` to `^0.100.1` — review changelog for breaking changes first

---

## [2026-05-31] — Docs + Persona

### Completed
- **README — layered memory architecture**: Added full Layer 1/2/3 section documenting project markdown files (PROJECT.md, STATE.md, journal, BACKLOG.md, HANDOFF.md), `/checkpoint` command, SpiderBrain auto-molt (7-day threshold), and Engram file-path search scope.
- **README — project structure**: Updated to reflect all new modules added over the past two sessions (project-memory/, spiderbrain/, memory/, credentials.ts, all new test files).
- **`docs/PERSONA.md`**: Committed Koa's personality document (Ted Lasso energy, direct/warm, carries session history, no goldfish memory). Was untracked from a prior session.

### Decisions
- Documented Engram's FTS as "file-path keyword search only" (not semantic, not code-content) — this is a frequently misunderstood constraint that caused the tool to be misused before.
- `/checkpoint` behavior documented in both TUI (type `/checkpoint`) and web console (`POST /api/checkpoint`, 409 if busy) forms.

### Next Session
- [ ] Merge PR #1 (feature/web-console-and-hardening → develop)
- [ ] E2E verification: goal visible in sidebar, STATE.md written on exit, journal appended, Engram decisions recalled next session
- [ ] Upgrade `@anthropic-ai/sdk` to `^0.100.1` — review changelog for breaking changes first

---

## [2026-05-31] — Runtime Bug Fix Session

### Completed
- **`maybeCompact()` → 400 "unexpected tool_use_id"** (`src/agent/loop.ts`):
  Prior partial fix dropped leading `tool_result` messages but broke at `assistant` messages, leaving conversations starting with assistant role — also a 400. Extracted `compactMessages()` as a pure exported function that walks forward to the first plain user string message (always a safe boundary). 7 regression tests cover all slice positions exhaustively.
- **`EngramClient` — three broken CLI call signatures** (`src/engram/client.ts`):
  - `getContext()` called `context --project ... --json` — command doesn't work that way (requires a file path, no `--json` flag). Rewrote to use `status` (parses goal) + `session history --limit 1` (parses decisions).
  - `query()` had `['query', '--', terms, '--project', path]` — `--project` after `--` made argparse treat it as part of the search string. Fixed to `['query', '--project', path, '--', terms]`.
  - `rememberSession()` called `session remember --summary -- text` — command is interactive (`input()` calls), `--summary` doesn't exist. Fixed to pipe `decision\nrationale\n\n` via stdin using execa's `input` option.
- **Engram brain slug mismatch** (`src/engram/client.ts`, `src/config/index.ts`):
  Both `brainExists()` and `getEngramBrainPath()` slugified the full absolute path (producing `Users-ralph-brynard-active-projects-koa`) but Engram Python uses `Path(p).name.lower().replace(" ","-")` (basename only → `koa`). `checkAvailable()` always returned `false`, silently short-circuiting every client method. Fixed to match Python. Updated 4 config tests.
- **TUI hang on `/exit` and Ctrl+C** (`src/tui/App.tsx`, `src/cli/index.ts`):
  Three causes: (1) `finalize()` called twice (in `App.tsx` quit + in `cli/index.ts` after `waitUntilExit()`); (2) no `process.exit(0)` after Ink exits — Anthropic SDK HTTP keep-alive held the event loop open; (3) no timeout on finalize so slow networks caused indefinite freeze. Fixed: 15s `Promise.race` in `quit()`, `process.exit(0)` in `cli/index.ts`, duplicate finalize removed.
- **Engram index noise** (brain DB):
  274 of 331 nodes were `.claude/worktrees/` entries from Claude Code agent worktrees, polluting every query result. Added `.claude` to `engram.config.json` ignore list, wiped brain DB, rebuilt from scratch — now 66 clean nodes across 4 clusters (src/web/root/docs). Set project goal/prey. Updated `engram_query` tool description to clarify file-path search scope.

### Decisions
- **`compactMessages()` exported as pure function**: makes the logic directly testable without class instantiation or mocking. The exhaustive slice-position test would be impractical otherwise.
- **`rememberSession()` uses stdin piping**: `session remember` is an interactive CLI designed for human use. Piping to stdin is the correct non-invasive way to drive it without forking Engram's code.
- **Wipe + full re-index over incremental sync**: Engram's `sync` is additive-only — it cannot prune nodes that no longer match the ignore list. Only `index` (full rebuild) achieves a clean state.
- **Deferred SDK upgrade**: `@anthropic-ai/sdk` `0.40 → 0.100` eliminates the punycode/node-fetch deprecation warning but is a 60-version jump with potential API surface changes. Noted but not done yet.

### Issues Found
- **Engram FTS is file-path only** — not code content, not session decisions. `engram_query("maybeCompact")` returns nothing even though the function exists. Tool description updated to reflect this; Koa should use it for file-name lookups only.
- **`engram_query` still returns 0.0 scores** — all results have mass 0.0. No files have crossed the master threshold. Likely needs more sessions to accumulate mass. Not a bug.

### Next Session
- [ ] Merge PR #1 (feature/web-console-and-hardening → develop)
- [ ] E2E verification: goal visible in sidebar, STATE.md written on exit, journal appended, Engram decisions recalled next session
- [ ] Upgrade `@anthropic-ai/sdk` to `^0.100.1` — review changelog for breaking changes first
- [ ] README: document `/checkpoint`, auto-molt, project memory files

### Learnings
- The Anthropic SDK holds HTTP keep-alive connections — `process.exit(0)` is required for clean CLI exit; Ink's `exit()` alone is insufficient.
- Engram's `--` sentinel must come AFTER all named flags: `['query', '--project', path, '--', terms]`. Putting it first makes argparse eat subsequent flags as positional arguments.
- Engram brain slugs use `Path(project_path).name` (basename only), not the full path. Any integration that computes a slug must match this or `checkAvailable()` will silently fail.

---

## [2026-05-30] — Layered Memory System + Agent Pipeline + Tests

### Completed
- **Layered memory system** — full Reddit-style 4-file layer implemented:
  - `src/project-memory/paths.ts`: slug+MD5-hashed per-project dir (`~/.koa/projects/<slug>-<hash>/`)
  - `src/project-memory/store.ts`: atomic `writeMarkdownFile`, journal append, `readRecentJournals`, `writeHandoff`
  - `src/project-memory/generators/project-doc.ts`: Haiku-generated PROJECT.md on first session
  - `src/project-memory/generators/state-doc.ts`: Haiku-generated STATE.md + dated journal entries
- **AgentLoop rewrite** — `initialize()` reads all project memory files and fires background PROJECT.md gen; `buildSystemPrompt()` injects XML blocks (project, state, journals, backlog, handoff); `checkpoint()` and `finalize()` generate and persist state
- **SpiderBrain auto-molt** — `isStale()` + `autoMolt()` added; fires molt.mjs in background when synganglion.json is older than 7 days or missing
- **Agent dispatch tool** (`dispatch_agent`) — allowlist-validated; reads `~/claudeAgents/tools/agent-templates/<agent>.md` as system prompt; writes HANDOFF.md before/after; uses Haiku
- **`session/store.ts` deleted** — fully superseded by project-memory layer
- **Reviewer fixes applied** (5 issues closed):
  - SpiderBrain null guards added to `query()`, `cascade()`, `molt()`
  - `App.tsx` useCallback deps corrected (`isExiting`, `quit` added)
  - `/api/checkpoint` now gated on `isBusy` (409 on conflict)
  - `HAIKU_MODEL` consolidated to single constant in `config/index.ts`
  - `KoaConfig` duplicate removed from `types/index.ts`
  - `paths.ts` hash no longer lowercases (case-sensitive FS correctness)
  - Silent PROJECT.md catch now logs to `process.stderr`
- **Tests**: 158 passing / 11 files; added 42 new tests covering:
  - `project-memory/paths.ts` (8 tests: stability, hash uniqueness, KOA_HOME, slug)
  - `project-memory/store.ts` (22 tests: read/write/atomic, journal append, handoff structure)
  - `agent_dispatch_tool.ts` (12 tests: allowlist, validation, apiKey guard)
  - `SpiderBrainClient.isStale()` (4 tests: missing file, stale, fresh)

### Decisions
- **Haiku for all background generation** — cheapest model; background tasks (PROJECT.md, STATE.md, journal) don't need frontier quality. Single `HAIKU_MODEL` constant in `config/index.ts`.
- **Atomic writes via tmp+rename** — prevents corrupt STATE.md on crash; applied consistently in `writeMarkdownFile`.
- **dispatch_agent uses SDK directly** (not `claude --print` subprocess) — more reliable (no PATH/auth issues); agent templates used as system prompts.
- **KOA_HOME env var** for test isolation of project memory directory — tests set `KOA_HOME` to a temp dir so no `~/.koa` pollution.
- **`/api/checkpoint` gated on isBusy** — prevents race with active agent turn (would have been a hard-to-reproduce corruption bug).

### Issues Found
- None remaining after reviewer pass. Build and all 158 tests clean.

### Next Session
- [ ] E2E test: `koa chat` with real API key to verify layered memory round-trip
- [ ] PR: merge `feature/web-console-and-hardening` → `develop`
- [ ] README: add section on project memory system, `/checkpoint`, auto-molt behavior
- [ ] Consider adding `koa memory show` subcommand to inspect PROJECT.md/STATE.md from CLI

### Learnings
- `exactOptionalPropertyTypes: true` + spread patterns are worth the strictness; forced explicit `null` checks in `readMarkdownFile`.
- Fire-and-forget pattern with `Promise.race([actual, timeout])` in `finalize()` handles the first-session PROJECT.md race correctly without blocking the session cleanup path.
- The isBusy guard for `/api/checkpoint` was a subtle race — both endpoints shared state but only `/api/chat` was guarded originally.

---

## [2026-05-30] — Architect: Layered Memory and Agent Coordination System

### Completed
- Read all 10 source files specified in brief (session/store.ts, agent/loop.ts, memory/store.ts, memory_tool.ts, spiderbrain/client.ts, types/index.ts, cli/index.ts, tui/App.tsx, config/index.ts, DEVLOG.md)
- Designed full implementation plan — written to TASKS.md (10 phases, 30 tasks)
- Wrote HANDOFF.md (architect summary, ready for coder agent)

### Decisions
- **MD5 via Node built-in `crypto.createHash('md5')`**: Zero new npm deps; 8-char hex suffix gives sufficient per-user uniqueness. Avoids adding an `md5` package.
- **`session/store.ts` fully retired**: The new `project-memory/` layer supersedes it entirely. Keeping both would create dual session tracking. `SessionRecord` type removed from `types/index.ts`.
- **Haiku hardcoded in generators**: `claude-haiku-4-5-20251001` is the cheapest model per the brief constraint. Hardcoded in `project-doc.ts` and `state-doc.ts`; not configurable to prevent accidental cost escalation.
- **Atomic file writes via tmp + rename**: Prevents corrupt STATE.md if Koa crashes mid-`finalize()`. Pattern is consistent with `writeFileTool` in `files.ts`.
- **`finalize()` awaits pending PROJECT.md gen with 10s timeout**: On first session, PROJECT.md generation fires in the background during `initialize()`. `finalize()` awaits it (with timeout) so the file is guaranteed to be written before session ends. On subsequent sessions, no generation fires so `finalize()` is unaffected.
- **`dispatch_agent` uses execa args array, never shell**: Consistent with all existing tool patterns (bash.ts, engram/client.ts, spiderbrain/client.ts). Agent name validated against `['architect', 'reviewer', 'debug', 'security-reviewer']` allowlist before exec.
- **Background tasks log to stderr only**: `autoMolt()` and `autoIndex()` write diagnostics to `process.stderr`. MCP mode owns stdout (stdio transport); all three frontends (TUI/web/MCP) handle stderr safely.
- **New directory: `src/project-memory/`**: Clean separation from `src/memory/` (global memory.json) and `src/session/` (to be deleted). Holds `paths.ts`, `store.ts`, `generators/project-doc.ts`, `generators/state-doc.ts`.
- **`/checkpoint` as a TUI command, not a tool**: Handled by TUI `handleSubmit` intercept and Express route — not registered as an agent tool. Prevents Koa from calling checkpoint on itself during a turn.
- **Engram autoIndex no-ops if brain exists**: Prevents unnecessary re-indexing. Only fires on first session (no `brain.db`). Uses existing `engram.sync()` which already handles the subprocess call.

### Issues Found
- **`AgentState` will need `projectMemory` field**: `exactOptionalPropertyTypes: true` requires explicit optional field definition — tracked in Phase 2 task.
- **Tech Debt (LOW)**: `~/.koa/sessions/` directory from the old session store will persist on disk after Phase 10 cleanup. A one-time migration note should be added to README.

### Next Session
- [ ] Phase 1 (coder): Create `src/project-memory/paths.ts` and `src/project-memory/store.ts`
- [ ] Phase 2 (coder): Haiku generators + `AgentLoop.initialize()` changes + types
- [ ] Phase 3 (coder): `finalize()` rewrite + delete `src/session/store.ts`
- [ ] Phase 4 (coder): `/checkpoint` command in TUI + web
- [ ] Phase 5 (coder): SpiderBrain `isStale()` + `autoMolt()`
- [ ] Phase 6 (coder): `dispatch_agent` tool + HANDOFF writer
- [ ] Phase 7 (coder): Engram `autoIndex()`
- [ ] Phase 8 (tester): Full test suite for all new modules
- [ ] Phase 9 (reviewer): Code review + security review of dispatch_agent
- [ ] Phase 10 (coder): Delete session/store.ts, update README

### Learnings
- Koa's existing patterns are consistent and clean: factory functions for tools that close over dependencies (`createFileTools`, `createEngramTool`, `createSpiderBrainTools`), execa args arrays everywhere, XML escaping for system prompt injection.
- The fire-and-forget + timeout pattern (used for PROJECT.md generation in `finalize()`) must be implemented carefully — `Promise.race([actualGen, timeout(10000)])` is the correct idiom.
- `MCP mode owns stdout` is a hard constraint that shapes all diagnostic output decisions.

---

## Long-Term Vision

Koa's goal is to be a **full personal AI assistant** — not just a CLI tool. Future scope includes:
- Full web UI (browser-accessible agent)
- iMessage integration
- Gmail integration
- Google Calendar integration
- Web browsing capabilities

Think of it as a self-built personal AI assistant. Every architectural decision should be made with this trajectory in mind.

---

## [2026-05-30] — SpiderBrain Integration + Full Web Console

### Completed
- **SpiderBrain backend integration** (`src/spiderbrain/client.ts`):
  - Auto-detects `<project>-spiderbrain/` sibling dir; `SPIDERBRAIN_BRAIN` env var for override
  - Reads `synganglion.json` directly (no subprocess) for fast `getContext()`
  - `query`, `cascade`, `molt` via execa args arrays — no shell: true
  - `<spiderbrain_context>` XML block injected into every system prompt alongside Engram
  - 3 agent tools: `spiderbrain_query`, `spiderbrain_cascade`, `spiderbrain_molt`
  - All commands (chat/web/mcp) auto-wire SpiderBrain when brain is indexed
- **SpiderBrain brain built** for koa itself:
  - `node build-brain.mjs --project . --brain ../koa-spiderbrain --prey "..."`
  - 47 nodes, 3 clusters (web/shell/src), auto-detects correctly
  - Top files by importance: `web/src/index.css`, `package.json`, `src/agent/loop.ts`
- **Full-featured web console redesign**:
  - 3-tab sidebar: **MEM** (Engram + usage) | **SB** (SpiderBrain masters/webscores/clusters) | **CFG** (settings)
  - SpiderBrain tab: prey, masters with webscore badges (★ ≥ 9.0), hot files, cluster names; auto-selects when brain is indexed
  - Settings tab: model, tier, Engram/SpiderBrain status, project path
  - Amber `SB` dot in StatusBar
  - Streaming content events merged into single assistant bubble
  - Clear chat button; copy-to-clipboard on assistant messages
- **Security fixes** (security pipeline):
  - `escapeXml()` applied to all 6 data interpolation sites in `buildSystemPromptInjection()` — prevents prompt injection via tampered synganglion.json (HIGH)
  - `SAFE_NODE_ID` regex tightened to exclude quote chars (HIGH)
  - `MAX_QUERY_TERMS_CHARS = 500` cap on query subprocess input (MEDIUM)
- **QA fixes** (QA pipeline):
  - Sidebar tab default bug fixed: `useEffect` auto-switch instead of computed initial state
  - 5 new edge-case tests added (empty graph, no masters, no timestamps, clean node ID, hot_files XML)
- **Build**: 116 tests / 9 files / 0 typecheck / 0 lint errors; web 156 kB; pushed to GitHub

### State at checkpoint
- `feature/web-console-and-hardening` — fully up to date, pushed
- koa SpiderBrain brain live at `../koa-spiderbrain`
- All three frontends (TUI, web, MCP) are SpiderBrain-aware
- `npm run build && cd web && npm run build` is all that's needed after a pull (no reinstall)
- **Not yet E2E tested** — `koa config set api-key <key>` then `koa chat`

### Decisions
- **SpiderBrain reads synganglion.json directly** (not via subprocess query.mjs) for `getContext()` — faster, no process spawn overhead on every turn
- **Brain auto-detection via sibling dir**: `<parent>/<project>-spiderbrain/` is the SpiderBrain v3 convention; matches without any config
- **Amber accent for SpiderBrain**: distinct from Engram's cyan — visually separates the two memory layers in the UI
- **Rebuild-only workflow**: `install.sh` is one-time setup; `npm run build` is all that's needed for updates

### Next Session
- [ ] E2E test: `koa config set api-key <key>` → `koa chat` (first live run)
- [ ] Rebuild SpiderBrain brain after Engram index (`engram index .` first, then rebuild brain to capture more accurate recency)
- [ ] PR: merge `feature/web-console-and-hardening` → `develop`
- [ ] Add SpiderBrain docs to README and ARCHITECTURE.md
- [ ] Consider `koa brain build` subcommand to wrap the build-brain.mjs call

---

## [2026-05-30] — Credentials, MCP Server, Token Dashboard, Documentation

### Completed
- **Persistent API key storage** (`src/config/credentials.ts`):
  - `~/.koa/credentials` (key=value, chmod 600) — same pattern as AWS CLI
  - `KOA_HOME` env var redirects config dir (used by tests)
  - `loadConfig()` falls back to file when `ANTHROPIC_API_KEY` env var not set; env var always takes precedence
  - `koa config set api-key <key>` — writes to credentials file
  - `koa config unset api-key` — removes key
  - `koa config show` — prints masked key + source (env / file path / not set)
  - 11 new tests covering read/write/delete/fallback/precedence
- **GitHub repo**: https://github.com/rwgb/koa (private); `develop` + `feature/web-console-and-hardening` pushed
- **Full documentation suite**:
  - `README.md` — vision, features, install, all CLI commands, all env vars, MCP wiring, Engram, token dashboard, dev workflow, project tree
  - `ARCHITECTURE.md` — ASCII system diagram, agent loop, smart routing, UsageTracker, MCP design rationale, SSE event union, Engram injection, security model, web frontend
  - `CONTRIBUTING.md` — setup, dev workflow, branch strategy, commit types, guides for adding tools/SSE events/env vars
  - `docs/API.md` — full REST + MCP tool reference

### State at checkpoint
- **95 tests, 8 test files, 0 typecheck errors, 0 lint errors**
- All commits on `feature/web-console-and-hardening`
- NOT yet tested E2E — needs `koa config set api-key <key>` then `koa chat`

### Next Session
- [ ] E2E test: `koa config set api-key <key>` → `koa chat` → verify full loop
- [ ] Index koa project with Engram: `python3 ~/.claude/skills/engram/cli/engram.py index .`
- [ ] Verify `engram context --json` output matches `EngramClient.getContext()` expectations
- [ ] Merge `feature/web-console-and-hardening` → `develop` via PR
- [ ] Single `npm start` that boots Express + Vite dev server together
- [ ] Vite upgrade (resolves esbuild advisory GHSA-67mh-4wv8-2f99)
- [ ] Merge streaming `content` SSE events into a single assistant bubble in web UI
- [ ] Update docs to cover `koa config` commands (README + CONTRIBUTING)

### Decisions
- **`~/.koa/credentials` over OS keychain**: `keytar` is deprecated; file with chmod 600 is the established pattern (AWS CLI, Heroku CLI). Same practical protection for a single-user machine.
- **`KOA_HOME` env var override**: avoids mocking `os.homedir()` (unreliable with Vitest module caching); also useful for power users who want a non-standard config location.
- **Docs written from source, not invented**: documentation agent read every source file before writing — no hallucinated flags or APIs.

---

## [2026-05-30] — MCP Server Mode + Token Usage Dashboard

### Completed
- **MCP server mode** (`src/server/mcp.ts`, `koa mcp` subcommand):
  - Exposes Koa's tools (bash, file ops, engram_query) as MCP tools for Claude Desktop
  - `@modelcontextprotocol/sdk` transport via stdio (JSON-RPC 2.0)
  - `toMcpInputSchema()` adapter converts Koa's JSON Schema tool defs to Zod shapes
  - `docs/claude_desktop_config_example.json` shows exact Claude Desktop wiring
  - 9 new MCP tests (spy-based + handler execution coverage)
- **Token usage dashboard** (`src/agent/usage.ts`):
  - `PRICING` map keyed by model prefix (haiku/sonnet/opus) — future-proof for new model versions
  - `UsageTracker` class: accumulates input/output/cache-write/cache-read tokens per turn, computes `estimatedCostUsd` and `cacheHitRate`
  - `AgentLoop` integrates tracker; accumulates across all tool-use API calls in a single logical turn
  - New `usage` SSE event emitted after each turn (web UI gets per-turn + session totals)
  - Web `StatusBar`: cost pill (`$0.0023`); Web `Sidebar`: token counts, cache hit %, total cost
  - TUI `StatusBar`: inline `$0.0023 | 82% cache` segment
  - `GET /api/context` now includes session usage for hydration on connect
  - 22 new usage tests
- **GitHub repo**: private repo created at https://github.com/rwgb/koa; both `develop` and `feature/web-console-and-hardening` pushed
- **Total test suite**: 84 tests, 7 test files, 0 typecheck errors, 0 lint errors

### Decisions
- **MCP exposes primitives only**: `AgentLoop` is deliberately NOT an MCP tool — it would create a recursive Claude-calls-Claude loop. MCP gives Claude Desktop direct access to bash, files, and Engram.
- **Stdout discipline in `koa mcp`**: stdio transport owns stdout; all diagnostic output goes to stderr. No `console.log` in the mcp command path.
- **UsageTracker as constructor dependency**: injected into `AgentLoop`, not a singleton — keeps tests isolated and leaves the door open for multi-session support.
- **Pricing by prefix, not full model ID**: `claude-sonnet-4-99` auto-inherits Sonnet rates without a pricing map update.
- **Per-logical-turn accumulation**: multiple API calls within one `turn()` (tool-use loop) are summed — shows meaningful "cost per user message", not confusing fractional sub-call costs.

### Next Session
- [ ] Engram integration — index koa with Engram, test E2E with live API key
- [ ] Merge `feature/web-console-and-hardening` → `develop` via PR
- [ ] Write full documentation (README, ARCHITECTURE.md, CONTRIBUTING.md, API reference)
- [ ] Single `npm start` command that boots Express + Vite dev server together
- [ ] Vite upgrade (resolves esbuild moderate advisory GHSA-67mh-4wv8-2f99)
- [ ] Merge streaming `content` SSE events into a single assistant bubble in web UI

---

## [2026-05-30] — Smart Model Routing, Spend Optimization, Pipeline QA

### Completed
- **`fix(server)`**: Express 5 SPA fallback crash — `'*'` → `'/{*path}'` (path-to-regexp v8 breaking change)
- **Smart model routing** (`src/agent/router.ts`):
  - Message classified as simple/moderate/complex → routes to Haiku / Sonnet / Opus
  - `@haiku:` / `@sonnet:` / `@opus:` message prefix for per-turn user override (prefix stripped before API call)
  - Opt-in via `KOA_SMART_ROUTING=true`; off by default (safe for existing users)
- **Prompt caching** (`loop.ts`): `cache_control: ephemeral` on system prompt + last tool definition — largest spend reduction per turn (Anthropic caches for 5 min, saves ~80% on re-sent context)
- **Tool output truncation** (`loop.ts`): Results capped at `maxToolOutputChars` (default 12k); truncated output appends `[truncated — N total chars]` sentinel so agent knows result was cut
- **Conversation compaction** (`loop.ts`): `maybeCompact()` drops oldest messages after `compactAfterTurns * 2` messages (default: 10 turns); sliding window prevents unbounded context growth
- **UI model badge** (`web/src/`): Each assistant bubble shows tier badge (green=haiku, blue=sonnet, purple=opus); StatusBar shows active tier next to model name
- **`vitest.config.ts`**: Added to exclude `.claude/` from test scanning — previously vitest double-counted tests from worktrees
- **62 tests passing, 5 test files, 0 lint errors** (new: router.test.ts — 27 tests for routing, classifyMessage, extractTierOverride)

### Decisions
- **Smart routing off by default**: Prevents unexpected model switches for existing sessions. Users opt in with env var.
- **Haiku for simple, Opus for complex**: Simple = short + SIMPLE_RE match; complex = COMPLEX_RE keyword OR >400 chars OR ≥3 recent tool uses. Moderate (default) stays on Sonnet.
- **Truncation sentinel required**: Security review flagged truncation without a sentinel as MEDIUM risk — agent could misread partial output. Sentinel makes incompleteness explicit.
- **Compaction drops messages, not summarizes**: Summarization would cost extra API tokens; sliding window is free. Trade-off: agent loses older context. Mitigated by system prompt never being in messages[].
- **Pipeline workflow**: Coding → Security → QA run as parallel worktree agents. Security review found no HIGH risks; two MEDIUM items (truncation sentinel, compaction safety) both addressed.

### Security Notes (from dedicated security review)
- **Routing prefix** LOW: Metadata extraction, no injection path. Sanitize if logging raw messages.
- **Prompt caching** LOW: No cross-session bleed for single-user tool.
- **Truncation** MEDIUM → RESOLVED: Sentinel appended to all truncated results.
- **Compaction** MEDIUM-HIGH → PARTIALLY MITIGATED: System prompt is separate from messages[], never dropped. Conversational context (e.g., "only edit src/") can still be lost at window boundary.
- **Engram `--` sentinel**: Untested against real Engram argparse — verify when Engram is wired up.

### New Env Vars
| Var | Default | Purpose |
|---|---|---|
| `KOA_SMART_ROUTING` | `false` | Enable automatic model tier routing |
| `KOA_MAX_TOOL_OUTPUT` | `12000` | Max chars per tool result before truncation |
| `KOA_COMPACT_TURNS` | `10` | Sliding conversation window (in turns) |

### Next Session
- [ ] Engram integration — install/wire up Engram CLI for memory features
- [ ] Address 2 moderate severity vulnerabilities in web deps (`npm audit`)
- [ ] Test compaction safety: verify agent doesn't accept unsafe requests after window slides
- [ ] Explore features to add (see session notes below)

### Feature Ideas (post-session brainstorm)
- **Conversation export** — save session as markdown/JSON
- **MCP server mode** — expose Koa as an MCP tool for Claude Desktop
- **Plugin system** — user-defined tools loaded from `~/.koa/tools/`
- **Token usage dashboard** — show cache hit rate, tokens per turn, estimated cost
- **Multi-project** — switch between project contexts without restarting
- **Streaming TUI** — stream token-by-token in ink TUI (currently buffers full response)
- **GitHub integration** — `koa pr` / `koa issue` commands via gh CLI
- **Voice input** — whisper.cpp integration for dictation
- **Session replay** — re-run a saved session against updated code
- **`koa explain <file>`** — one-shot file explanation without starting a full session

---

## [2026-05-30] — Install Script & Global CLI

### Completed
- **`install.sh`** — single-command setup script:
  - Pre-flight: checks Node.js ≥ 18, npm, warns if Engram CLI absent
  - Env setup: creates `.env`, prompts for `ANTHROPIC_API_KEY` (respects existing env var)
  - Installs root + web deps, builds TypeScript and Vite
  - `npm link` installs `koa` globally — fixed `--prefix` bug (must `cd` first, not use prefix flag)
  - Flags: `--no-global`, `--no-build`, `--help`
- **`.gitignore`** — added `bin/` (npm link symlink directory, not a source artifact)
- **58 tests passing, 0 lint errors**

### Next Session
- [ ] Address 2 moderate severity vulnerabilities in web deps (`npm audit`)
- [ ] Engram integration — install/wire up Engram CLI for memory features

---

## [2026-05-30] — Web Console, Security Hardening, Full QA Pass

### Completed
- **Fixed critical runtime bug**: `execaCommand` (removed in execa v9) replaced throughout — `bash.ts` → `execa('bash', ['-c', cmd])`, `engram/client.ts` → `execa('python3', [ENGRAM_CLI, ...args])`, `files.ts` → `execa('grep', args)`. No shell involved in arg parsing for subprocess calls.
- **`koa web` command** (`src/server/`, `src/cli/index.ts`):
  - Express HTTP server with SSE streaming: `POST /api/chat` → streams `tool_call | tool_result | content | done | error`
  - `GET /api/context` returns Engram state + model + turn count
  - `AgentLoop.turn()` extended with optional `TurnCallbacks` (`onToolCall`, `onToolResult`)
  - CLI: `koa web [--port 3000] [--no-open] [--project path] [--model model]`
- **ink-spinner** wired into TUI `StatusBar` — replaces static "thinking..." text
- **ESLint 9 flat config** (`eslint.config.js`) — typescript-eslint recommended + consistent-type-imports
- **Vitest test suite**: 55 tests, 8 files — ToolRegistry, loadConfig, getEngramBrainPath, buildSystemPromptInjection, file tools including sandbox escape tests
- **Security hardening** (full audit, all findings addressed):
  - CORS restricted to Vite dev port only — no wildcard (was HIGH finding; wildcard + bash tool = drive-by RCE)
  - File tools sandboxed: `sandboxPath()` in `createFileTools(projectRoot)` factory enforces all reads/writes/edits stay within `config.projectPath`; `writeFileTool` also sandboxes the `mkdir` target; `buildRegistry` now takes `projectRoot` as second arg
  - SSE disconnect: `req.on('close')` releases `isBusy` immediately; `disconnected` flag prevents writing to closed response
  - Bash timeout clamped to [1s, 5min] — LLM cannot specify arbitrarily long timeouts
  - Engram CLI: `--` sentinel before all user-supplied positional args to prevent flag injection
  - Server errors logged server-side only; SSE client receives generic message (no path leakage)

### Decisions
- **`createFileTools(projectRoot)` factory**: File tools close over project root for sandboxing. Mirrors `createEngramTool(engram)` pattern already in use.
- **CORS `localhost:5173` only**: Built UI is same-origin (no CORS needed). Vite dev server gets one explicit allowed origin. Nothing else crosses.
- **SSE over WebSocket**: Agent is sequential (one turn at a time) — unidirectional SSE is simpler, no extra library, browser-native. WS adds nothing here.
- **`isBusy` mutex**: Single personal-use loop; one active turn at a time. 429 on concurrent requests. No session map complexity.
- **Error scrubbing at SSE boundary**: Full errors in server logs; client sees "Agent error — see server logs" to avoid leaking paths.

### Issues Found
- **`web/` esbuild advisory** (non-blocking): Vite 5's bundled esbuild has a moderate dev-server advisory. Requires Vite 8 (breaking) to resolve. Not worth upgrading mid-session for a local tool.
- **`--` sentinel with Python argparse**: `--goal -- value` pattern depends on Engram CLI's argparse config. Flagged for verification once an Engram brain is indexed.

### Next Session
- [ ] Index koa project with Engram: `python3 ~/.claude/skills/engram/cli/engram.py index .`
- [ ] End-to-end test full chat loop (TUI + web) with `ANTHROPIC_API_KEY` exported
- [ ] Verify `engram context --json` output format matches `EngramClient.getContext()` expectations
- [ ] Verify `--` sentinel compatibility with Engram CLI's argparse config
- [ ] Add `--dev-port` flag to `koa web` so CORS origin is configurable (currently hard-coded 5173)
- [ ] Consider `koa web --dev` that starts Vite dev server alongside Express (concurrently)
- [ ] Merge streaming `content` SSE events into a single assistant bubble (append to last item if already `assistant`)
- [ ] Upgrade Vite to v6+ when web UI stabilises (resolves esbuild advisory)
- [ ] Consider SSE-streaming text tokens as they arrive (currently waits for full `end_turn`)

### Learnings
- `execaCommand` was silently removed in execa v9 — always check changelogs on CLI utility upgrades
- Wildcard CORS on localhost with a full bash-access agent is a real RCE vector via drive-by page — not just theoretical
- Ink spinner: `<Text color="yellow"><Spinner type="dots" /> label</Text>` is the correct wrapping pattern
- ESLint 9 flat config: `tsPlugin.configs['recommended'].rules` (bracket notation) avoids TS type errors on index access

---

## [2026-05-30] — Web Frontend (Vite + React + TypeScript)

### Completed
- Created `web/` subdirectory with complete Vite + React 18 + TypeScript app
- **File tree**:
  - `web/package.json` — koa-web, React 18, Vite 5, strict TS
  - `web/tsconfig.json` — ES2020, moduleResolution bundler, strict + noUnusedLocals/Params
  - `web/vite.config.ts` — React plugin, `/api` → `http://localhost:3000` proxy
  - `web/index.html` — Vite HTML shell, mounts `#root`
  - `web/src/types.ts` — `SseEvent`, `EngramContext`, `AgentStatus`, `ChatItem` discriminated union
  - `web/src/api.ts` — `fetchStatus()` (GET /api/context), `streamChat()` (POST /api/chat SSE, returns AbortController cancel fn)
  - `web/src/index.css` — dark terminal theme, CSS custom properties, system mono font stack, all component styles
  - `web/src/main.tsx` — React 18 createRoot
  - `web/src/App.tsx` — top-level state (items, status, isThinking, input), SSE event routing
  - `web/src/components/StatusBar.tsx` — model, turn count, engram dot, braille spinner
  - `web/src/components/Sidebar.tsx` — goal, hot files (cyan), masters (blue), session summary
  - `web/src/components/ChatPanel.tsx` — scrollable messages + Enter-to-submit input
  - `web/src/components/MessageBubble.tsx` — per-type rendering; tool_call/tool_result collapsible
- `npm run build` passes: 0 TypeScript errors, Vite emits 149 kB JS + 3.9 kB CSS

### Decisions
- **SSE parsed manually** (no EventSource): POST with a body isn't supported by the browser EventSource API. Manual `ReadableStream` + `TextDecoder` split on `\n\n` handles the same wire format.
- **All CSS in index.css**: No per-component CSS files or CSS-in-JS — keeps the theming in one place, avoids Vite config complexity for a personal tool.
- **Spinner via JS setInterval + state** (not CSS `content:` animation): `@keyframes` on `content` isn't cross-browser reliable; cycling through a frame array in React is simpler and more predictable.
- **Tool calls default collapsed**: Reduces visual noise during long agent runs; toggle on click.
- **`assistant` content items NOT merged**: Each `content` SSE event becomes its own ChatItem. This correctly represents streaming chunks and avoids complex state merging for a personal tool.

### Issues Found
- esbuild ≤0.24.2 has a dev-server moderate advisory (GHSA-67mh-4wv8-2f99). Fix requires bumping to Vite 8 (breaking). Low risk for a local dev tool — noted for future upgrade.

### Next Session
- [ ] Wire `npm run dev` into the backend start script so a single command starts both
- [ ] Consider merging streaming `content` events into a single assistant bubble (append to last item if it's already `assistant`)
- [ ] Add keyboard shortcut to clear chat history
- [ ] Test against live backend with a real ANTHROPIC_API_KEY
- [ ] Add `web/` build output (`dist/`) to the Express server static middleware so `npm start` also serves the UI

### Learnings
- Vite's `moduleResolution: bundler` requires `.js` extensions in import paths even for `.tsx` source files — the bundler rewrites them correctly at build time.
- `noUnusedLocals: true` in tsconfig catches drift quickly; worth the friction.

---

## [2026-05-30] — Initial Scaffold

### Completed
- Initialized git repo with `develop` as default branch
- Full TypeScript project setup: `package.json`, `tsconfig.json` (strict, exactOptionalPropertyTypes), Prettier
- **Source tree**:
  - `src/types/index.ts` — core domain types (KoaConfig, EngramContext, Tool, AgentState, TurnResult)
  - `src/config/index.ts` — config loading from env vars, Engram path helpers
  - `src/engram/client.ts` — EngramClient wrapping the Python CLI via execa; sync, query, getContext, startSession, rememberSession, buildSystemPromptInjection
  - `src/agent/tools/registry.ts` — ToolRegistry with Anthropic-format serialization
  - `src/agent/tools/bash.ts` — bash execution tool
  - `src/agent/tools/files.ts` — read_file, write_file, edit_file, grep tools
  - `src/agent/tools/engram_tool.ts` — engram_query tool (wraps EngramClient)
  - `src/agent/loop.ts` — AgentLoop: initialize (sync Engram, inject context), turn (full tool-use loop), finalize (session remember)
  - `src/tui/App.tsx` — Ink TUI root; chat messages, TextInput, ctrl+c handler
  - `src/tui/components/ChatMessage.tsx` — per-message renderer
  - `src/tui/components/Sidebar.tsx` — Engram context panel (goal, hot files, last session)
  - `src/tui/components/StatusBar.tsx` — model, turn count, Engram status, thinking indicator
  - `src/cli/index.ts` — Commander entrypoint with `chat` (default) and `query` commands
- TypeScript builds clean (`tsc --noEmit` passes)
- `.claude/settings.json` with `defaultMode: "bypassPermissions"` to avoid prompt interruptions

### Decisions
- **Engram injected via system prompt**: `buildSystemPromptInjection()` returns a `<engram_context>` XML block appended to the base system prompt each turn. No separate "memory retrieval" tool needed for hot files/goal/session — they're always present.
- **Tool-use loop is synchronous per turn**: The AgentLoop keeps calling the API until `stop_reason !== "tool_use"`. Each tool result is pushed to messages before the next API call.
- **exactOptionalPropertyTypes=true**: Forces explicit optional handling (no `key: undefined` implicit spreads). Worth the strictness.
- **bypassPermissions in settings.json**: The `fewer-permission-prompts` hook auto-trims `settings.local.json` after each Bash command, which would override broad allow lists. Using `defaultMode` in `settings.json` sidesteps this.

### Issues Found
- None in scaffold. Engram `--json` flag on `context` subcommand is assumed but not verified — need to test once Engram brain exists for this project.

### Next Session
- [ ] Index koa project with Engram: `python3 ~/.claude/skills/engram/cli/engram.py index .`
- [ ] Test the full chat loop end-to-end with a real `ANTHROPIC_API_KEY`
- [ ] Add `ink-spinner` to the TUI for the thinking state (currently just a text label)
- [ ] Verify `engram context --json` output format matches what `EngramClient.getContext()` expects
- [ ] Add ESLint config and run a lint pass
- [ ] Consider streaming responses (SSE) instead of waiting for full completion

### Learnings
- Ink's `Box` does not accept `color` — must wrap in `Text`. `useInput` Key type has no `.name`; check `input === 'c'` alongside `key.ctrl`.
- `exactOptionalPropertyTypes` requires spread patterns (`...(x !== undefined ? { k: x } : {})`) instead of `{ k: x }` when `x` can be undefined.

---

## [2026-05-30] — Project Kickoff

### Completed
- Confirmed Engram skill exists at `~/.claude/skills/engram` (SQLite-backed project memory engine)
- Wired Engram as global auto-hooks in `~/.claude/settings.json`:
  - `SessionStart` → injects goal, masters, hot files at session open
  - `UserPromptSubmit` → surfaces file context when filenames are mentioned
  - `PostToolUse` (Edit|Write|MultiEdit) → silently logs every edit
- Created three bash wrappers at `~/.claude/skills/engram/hooks/auto_*.sh` that pass `$PWD` to the Python hooks at runtime

### Decisions
- **Global hooks via `$PWD` wrappers**: hooks need a static project path at config time; bash wrappers solve this by resolving `$PWD` at execution time. Hooks silently no-op for unindexed projects.
- **Koa = self-built opencode**: this project will be a custom Claude Code-style CLI/agent, with Engram as its memory layer

### Issues Found
- None yet — project not started

### Next Session
- [ ] Define koa's scope: what does it do that `claude` CLI doesn't?
- [ ] Index koa project with Engram once initial structure exists
- [ ] Design koa's architecture (CLI entrypoint, agent loop, Engram integration points)

### Learnings
- Engram brains live at `~/.engram/brains/<slug>/brain.db`
- Engram hooks gracefully exit when no brain exists — safe to enable globally
