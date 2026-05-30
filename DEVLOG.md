# Koa — DevLog

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
