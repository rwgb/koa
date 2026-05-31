## Tasks — Layered Memory and Agent Coordination System

> Designed by: architect agent — 2026-05-30
> Branch: feature/layered-memory (branch from develop)

---

### Overview

This plan adds three new capabilities to Koa:

1. **Working Memory** — per-project markdown files at `~/.koa/projects/<slug>-<hash>/` (PROJECT.md, STATE.md, BACKLOG.md, HANDOFF.md, journal/)
2. **SpiderBrain auto-molt** — runs automatically on first session (non-blocking) instead of requiring manual `koa brain build`
3. **Agent coordination** — Koa spawns specialist sub-agents from `~/claudeAgents/tools/agent-templates/` via bash tool; HANDOFF.md tracks inter-agent state

The existing `session/store.ts` is retired and replaced by the working memory layer. `engram/` and `memory/store.ts` stay unchanged.

---

### Phase 1: Project Memory Directory — Core Infrastructure

**Goal**: Establish the `~/.koa/projects/<slug>-<hash>/` directory structure and the module that reads/writes it.

- [ ] Create `src/project-memory/paths.ts` (owner: coder) — Exports `projectMemoryDir(projectPath: string): string` using `path.basename(projectPath) + '-' + md5(projectPath.toLowerCase()).slice(0, 8)`. Also exports `projectMemoryPaths(projectPath)` returning typed paths for all five files (PROJECT.md, STATE.md, BACKLOG.md, HANDOFF.md, journal dir). No external deps — use Node.js built-in `crypto.createHash('md5')`. AC: Unit test confirms `~/.koa/projects/koa-<8hex>/` for a given path; hash is stable across calls.

- [ ] Create `src/project-memory/store.ts` (owner: coder) — Exports: `ensureProjectMemoryDir(projectPath)` (mkdir recursive, chmod 700), `readMarkdownFile(filePath): string | null` (returns null on ENOENT, throws on other errors), `writeMarkdownFile(filePath, content)` (atomic: write to `.tmp`, rename to final; chmod 600), `appendJournalEntry(projectPath, content)` (appends to today's `journal/YYYY-MM-DD.md`, creates if absent). AC: All four exports covered by unit tests including the atomic write path.

- [ ] Add `md5` hash utility (owner: coder) — Use Node.js built-in `crypto.createHash('md5')` only; zero new npm deps. AC: `tsc --noEmit` passes, no new packages in package.json.

---

### Phase 2: PROJECT.md and STATE.md — Auto-Generation

**Goal**: On first session, generate PROJECT.md from SpiderBrain context + codebase scan. Write STATE.md at session end and on `/checkpoint`.

- [ ] Create `src/project-memory/generators/project-doc.ts` (owner: coder) — `generateProjectDoc(projectPath, sbContext, apiKey): Promise<string>`. Makes a single Haiku call (`claude-haiku-4-5-20251001`, max_tokens: 1024) with a prompt instructing the model to produce a PROJECT.md covering: tech stack (inferred from package.json if present), architecture summary, key conventions, SpiderBrain hot files. Returns the markdown string; caller writes it. AC: Function signature correct, Haiku model hardcoded, prompt instructs JSON-safe output; unit test mocks Anthropic SDK and asserts returned string starts with `# PROJECT`.

- [ ] Create `src/project-memory/generators/state-doc.ts` (owner: coder) — `generateStateDoc(projectPath, conversationSummary, turnCount, apiKey): Promise<string>`. Makes a single Haiku call summarizing what's in flight: what was accomplished this session, key decisions, what failed, what's next. Returns markdown for STATE.md. AC: Unit test mocks SDK; generated doc contains `## In Progress` and `## Next` sections.

- [ ] Extend `AgentLoop.initialize()` in `src/agent/loop.ts` (owner: coder) — After existing init steps, call `ensureProjectMemoryDir(this.config.projectPath)`. If PROJECT.md does not exist, fire `generateProjectDoc(...)` as a background Promise (do NOT await; assign to `this._projectDocGeneration`). Read STATE.md (if exists) and BACKLOG.md (if exists) into `this.state.projectMemory`. AC: `initialize()` still returns in <200 ms on a project with no PROJECT.md (generation is fire-and-forget). Unit test asserts `state.projectMemory.state` is populated when STATE.md pre-exists.

- [ ] Add `projectMemory` field to `AgentState` in `src/types/index.ts` (owner: coder) — `projectMemory?: { project?: string; state?: string; backlog?: string; handoff?: string }`. Use `exactOptionalPropertyTypes`-safe definition. AC: `tsc --noEmit` passes.

- [ ] Extend `buildSystemPrompt()` in `src/agent/loop.ts` (owner: coder) — Inject project memory files into the system prompt after existing injections: `<project_memory>`, `<state>`, `<backlog>`, `<handoff>` XML blocks (only if content is non-empty). Escape XML special chars. Each block tagged for cache stability (content rarely changes). AC: Unit test asserts XML blocks appear in system prompt when state fields are set; absent fields produce no XML block.

---

### Phase 3: Journal and Session Finalization

**Goal**: Replace `session/store.ts` with journal-based finalization. Session JSON store is retired.

- [ ] Update `AgentLoop.finalize()` in `src/agent/loop.ts` (owner: coder) — Remove calls to `saveSession()` and `buildSessionRecord()`. Instead: (1) if `this.state.turnCount === 0`, return immediately; (2) build a conversation summary string from tool uses and user messages; (3) await `this._projectDocGeneration` if it's still pending (with a 10s timeout — resolve with null if it times out); (4) call `generateStateDoc(...)` and write result to STATE.md; (5) call `appendJournalEntry(projectPath, journalContent)` where journalContent is a dated Haiku-generated session log. All three LLM calls (project doc if pending, state doc, journal) must complete before `finalize()` returns. Total budget: <10s. AC: Integration test mocks SDK calls; `finalize()` resolves in <500ms in test (mocked); journal file is written; STATE.md is written; no calls to `saveSession`.

- [ ] Delete `src/session/store.ts` (owner: coder) — Remove file and all imports from `loop.ts`. Update `src/types/index.ts` to remove `SessionRecord` if no longer referenced. AC: `tsc --noEmit` passes; `grep -r 'session/store'` returns no hits in `src/`.

- [ ] Update `AgentLoop.initialize()` to read HANDOFF.md (owner: coder) — Load HANDOFF.md (if exists) into `state.projectMemory.handoff`. AC: Handoff content appears in system prompt under `<handoff>` tag.

---

### Phase 4: `/checkpoint` Command

**Goal**: Add `/checkpoint` as a TUI command that immediately writes STATE.md without ending the session.

- [ ] Add `checkpoint()` method to `AgentLoop` in `src/agent/loop.ts` (owner: coder) — `async checkpoint(): Promise<void>`. Builds current in-flight summary from messages and calls `generateStateDoc(...)` then writes to STATE.md. Does NOT write journal. Does NOT end session. Resolves in <10s. AC: Unit test asserts STATE.md written after `checkpoint()` call with mocked SDK; turnCount unchanged.

- [ ] Add `/checkpoint` handler to `src/tui/App.tsx` (owner: coder) — In `handleSubmit`, before the existing `/exit` check, detect `trimmed === '/checkpoint'`. Call `loop.checkpoint()`, show a one-turn assistant message "Checkpoint saved." Clear input. Do not send to agent turn. AC: Typing `/checkpoint` in TUI writes STATE.md and shows confirmation; does not increment turn count or call `loop.turn()`.

- [ ] Add `/checkpoint` to web console (owner: coder) — In `src/server/index.ts` (Express POST /api/chat handler), detect if the body message is `/checkpoint`. If so, call `loop.checkpoint()` and return a non-streaming 200 JSON `{ status: 'ok', message: 'Checkpoint saved.' }` without going through the agent turn. AC: `POST /api/chat` with body `{ message: '/checkpoint' }` returns 200 JSON without SSE; STATE.md updated.

---

### Phase 5: SpiderBrain Auto-Molt

**Goal**: On first session (no brain exists) or stale brain (>7 days), trigger `molt()` in the background without blocking chat startup.

- [ ] Add `isStale(brainDir)` helper to `src/spiderbrain/client.ts` (owner: coder) — Checks `mtime` of `synganglion.json`; returns true if absent or if `Date.now() - mtime > 7 * 24 * 60 * 60 * 1000`. AC: Unit test asserts returns true for missing file; returns false for fresh file; returns true for a file whose mtime is set 8 days ago.

- [ ] Add `autoMolt(brainDir?)` method to `SpiderBrainClient` (owner: coder) — If `brainDir` is null or `isStale()` is true, call `this.molt()` (which runs the molt.mjs subprocess). Returns a Promise; caller must NOT await it in the hot path. Stores the Promise in `this._moltPromise` for later introspection. If `brainDir` is null and the SpiderBrain scripts dir doesn't exist, no-ops silently. AC: Unit test with mocked `execa` asserts `molt()` is called when synganglion is absent; not called when fresh.

- [ ] Call `sb.autoMolt()` in `AgentLoop.initialize()` (owner: coder) — Fire-and-forget: `void this.sb.autoMolt()`. Call it after `this.state.spiderBrainContext = await this.sb.getContext()`. AC: `initialize()` returns without awaiting molt; E2E smoke test logs "(SpiderBrain auto-molt started in background)" without blocking.

- [ ] Log auto-molt start/finish to stderr (owner: coder) — `autoMolt()` logs `[SpiderBrain] auto-molt started` to `process.stderr` on launch and `[SpiderBrain] auto-molt complete` or `[SpiderBrain] auto-molt failed: <message>` on settle. No stdout (MCP mode uses stdout). AC: Stderr log appears in test output; stdout is clean.

---

### Phase 6: Agent Coordination via HANDOFF.md

**Goal**: Koa can spawn specialist agents from `~/claudeAgents/tools/agent-templates/` and track handoff state in HANDOFF.md.

- [ ] Create `src/agent/tools/agent_dispatch_tool.ts` (owner: coder) — Exports `createAgentDispatchTool(projectPath: string): Tool`. Tool name: `dispatch_agent`. Input schema: `{ agent: string, task: string, context?: string }` where `agent` is one of `architect | reviewer | debug | security-reviewer`. Execution: (1) validate agent is in allowed list; (2) read template from `~/claudeAgents/tools/agent-templates/<agent>.md`; (3) construct a Claude Code `claude --print` invocation via bash; (4) write pre-dispatch HANDOFF.md with status `RUNNING`; (5) run the agent via `execa('claude', ['--print', '--model', 'claude-haiku-4-5-20251001', task], { cwd: projectPath })`; (6) write post-dispatch HANDOFF.md with status `PASS` or `FAIL`. Returns agent stdout (truncated to `maxToolOutputChars`). AC: Unit test mocks `execa`; HANDOFF.md written with RUNNING before exec, PASS after; invalid agent name returns error string without exec.

- [ ] Register `dispatch_agent` tool in `buildRegistry()` in `src/cli/index.ts` (owner: coder) — Add `registry.register(createAgentDispatchTool(config.projectPath))`. AC: `koa chat` exposes `dispatch_agent` in tool list; `tsc --noEmit` passes.

- [ ] Add HANDOFF.md writer helper to `src/project-memory/store.ts` (owner: coder) — `writeHandoff(projectPath, { agent, lastAgent, nextAgent, status, plan, tasks })`. Formats the canonical HANDOFF.md structure matching the architect template. AC: Unit test asserts output string matches expected HANDOFF.md markdown structure.

---

### Phase 7: Engram Auto-Index (Background, Non-Blocking)

**Goal**: On first session, trigger Engram indexing in the background if no brain exists.

- [ ] Add `autoIndex(projectPath)` to `src/engram/client.ts` (owner: coder) — Checks if `~/.engram/brains/<slug>/brain.db` exists. If not, fires `engram.sync()` in background (already exists on EngramClient). Store promise in `this._indexPromise`. Log to stderr. Caller must NOT await. AC: Unit test asserts `sync()` called when brain absent; not called when brain exists.

- [ ] Call `engram.autoIndex(projectPath)` in `AgentLoop.initialize()` (owner: coder) — Fire-and-forget: `void this.engram.autoIndex(this.config.projectPath)`. Called only if `this.config.engramEnabled`. AC: `initialize()` returns without awaiting Engram index; Engram sync still completes asynchronously.

---

### Phase 8: Tests

**Goal**: Full test coverage for all new modules. No regressions.

- [ ] Unit tests for `src/project-memory/paths.ts` (owner: tester) — 3 tests: hash stability, slug format, `KOA_HOME` env var override. AC: All pass; no filesystem side effects.

- [ ] Unit tests for `src/project-memory/store.ts` (owner: tester) — 6 tests: ensureDir creates with correct permissions, readMarkdownFile returns null on ENOENT, writeMarkdownFile atomic (tmp file cleaned up), appendJournalEntry creates journal dir, appendJournalEntry appends to existing file, writeHandoff produces correct HANDOFF.md structure. AC: All pass; uses `KOA_HOME` temp dir.

- [ ] Unit tests for `generators/project-doc.ts` and `generators/state-doc.ts` (owner: tester) — 4 tests: Haiku model used, prompt contains project path, returned string non-empty, SDK error propagated. AC: All pass; Anthropic SDK mocked via `vi.mock`.

- [ ] Unit tests for `AgentLoop` changes (owner: tester) — 5 tests: `initialize()` returns without awaiting background gen, `finalize()` writes journal and STATE.md, `finalize()` no-ops at turnCount 0, `checkpoint()` writes STATE.md only, `buildSystemPrompt()` includes project memory XML blocks. AC: All pass; no real API calls.

- [ ] Unit tests for `SpiderBrainClient.isStale()` and `autoMolt()` (owner: tester) — 4 tests: stale on missing file, stale on old mtime, fresh on recent mtime, autoMolt calls molt only when stale. AC: All pass.

- [ ] Unit tests for `dispatch_agent` tool (owner: tester) — 4 tests: invalid agent returns error, HANDOFF.md written with RUNNING before exec, PASS status written on success, FAIL status on exec error. AC: All pass; `execa` mocked.

- [ ] Integration smoke test for `AgentLoop.finalize()` timing (owner: tester) — Asserts `finalize()` with all mocked SDK calls returns in <500ms. AC: Test passes with mocked LLM.

- [ ] Run full test suite after all changes (owner: tester) — `npm test` must pass with zero failures. AC: CI-clean test run, 0 lint errors, 0 typecheck errors.

---

### Phase 9: Review

- [ ] Code review all new modules (owner: reviewer) — Focus on: (1) no awaits in fire-and-forget paths; (2) atomic file writes everywhere; (3) `exactOptionalPropertyTypes` compliance; (4) no shell: true in execa calls; (5) XML escaping in system prompt; (6) Haiku model hardcoded correctly. AC: Reviewer signs off; no HIGH findings.

- [ ] Security review of `dispatch_agent` tool (owner: reviewer) — Verify: agent name validated against allowlist before any FS or exec operations; no user-supplied string reaches shell unescaped; task/context strings passed as execa args (not shell-interpolated). AC: No HIGH or MEDIUM findings unresolved.

---

### Phase 10: Deprecation Cleanup

- [ ] Remove legacy `src/session/store.ts` (owner: coder) — File deleted; all imports removed; `SessionRecord` type removed from `types/index.ts` if unreferenced. AC: `tsc --noEmit` passes; `grep -r 'SessionRecord\|session/store'` returns zero hits in `src/`.

- [ ] Update `src/tui/App.tsx` help text (owner: coder) — Change placeholder text from "Ask Koa anything... (/exit to quit)" to "Ask Koa anything... (/exit · /checkpoint)". AC: Visual change confirmed in TUI.

- [ ] Update `README.md` with new commands and memory layer description (owner: coder) — Add section: "Project Memory" explaining `~/.koa/projects/<slug>/` structure, `/checkpoint` command, auto-molt behavior. AC: README section present and accurate; no made-up flags.

---

### Directory Structure After Implementation

```
~/.koa/
  projects/
    koa-a1b2c3d4/        # slug + 8-char md5 of absolute project path
      PROJECT.md          # architecture, stack, conventions (Haiku-generated)
      STATE.md            # current in-flight work (updated at finalize + checkpoint)
      BACKLOG.md          # prioritized items (updated by Koa proactively or user)
      HANDOFF.md          # agent pipeline state
      journal/
        2026-05-30.md     # per-day session log (appended)
        2026-05-31.md
  memory.json             # existing global memory store (unchanged)
  credentials             # existing credentials file (unchanged)
  sessions/               # DEPRECATED — can be deleted after Phase 10

src/project-memory/       # NEW
  paths.ts                # slug+hash, all file paths
  store.ts                # read/write/append helpers
  generators/
    project-doc.ts        # Haiku call → PROJECT.md content
    state-doc.ts          # Haiku call → STATE.md content

src/agent/tools/
  agent_dispatch_tool.ts  # NEW: dispatch_agent tool
  (all existing tools unchanged)

src/session/
  store.ts                # DELETED in Phase 10
```

---

### Key Decisions (Architect)

| Decision | Rationale |
|---|---|
| MD5 via Node built-in `crypto` | Zero new deps; 8 hex chars gives sufficient uniqueness per user |
| Haiku for all LLM calls in this layer | Cost optimization per brief constraint; journal/state are short outputs |
| Atomic file writes (tmp + rename) | Prevents corrupt STATE.md on crash during finalize |
| `finalize()` awaits pending background gen with 10s timeout | Guarantees PROJECT.md is written on first session; timeout prevents hang |
| `dispatch_agent` uses execa args array not shell | Consistent with existing bash/engram/spiderbrain patterns; prevents arg injection |
| Agent allowlist validated before exec | Security: prevents Koa from being convinced to run arbitrary agent names |
| `session/store.ts` retired, not extended | The new journal layer supersedes it entirely; keeping both would duplicate session tracking |
| `autoMolt()` / `autoIndex()` log to stderr only | MCP mode owns stdout; stderr is safe for diagnostics in all three frontends |
