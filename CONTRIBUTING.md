# Contributing to Koa

Koa is a personal project. This document describes the development workflow, conventions, and the patterns used to extend the system.

---

## Setup

```bash
git clone git@github.com:rwgb/koa.git
cd koa
./install.sh
export ANTHROPIC_API_KEY=sk-ant-...
```

The install script installs all dependencies, compiles TypeScript, builds the Vite web console, and links the `koa` binary globally. See `README.md` for details on install flags.

---

## Dev Workflow

Run the backend API server and the Vite dev server in two separate terminals:

```bash
# Terminal 1 — Express + AgentLoop (hot-reload via tsx watch)
npm run dev

# Terminal 2 — Vite dev server with /api proxy to port 3000
cd web && npm run dev
```

Open `http://localhost:5173` for the web console. The Vite dev server proxies all `/api` requests to `http://localhost:3000`.

> The TUI does not need the Express server. Run `npm run dev` and interact via the terminal directly.

---

## Testing

```bash
# Run the full test suite once
npm test

# Watch mode (re-runs affected tests on save)
npm run test:watch

# Coverage report
npm run test:coverage

# Type-check without emitting
npm run typecheck

# Lint
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

All tests live in `src/__tests__/`. Test files follow the pattern `<subject>.test.ts`. The test runner is Vitest. The `.claude/` worktree directory is excluded from test scanning in `vitest.config.ts`.

Do not commit with failing tests or type errors.

---

## Branch Strategy

| Branch type | Base branch | Merges to | Naming |
|-------------|-------------|-----------|--------|
| `feature` | `develop` | `develop` (via PR) | `feature/description` |
| `bugfix` | `develop` | `develop` (via PR) | `bugfix/issue-123` |
| `hotfix` | `main` | `main` + `develop` | `hotfix/description` |
| `release` | `develop` | `main` + `develop` | `release/v1.x.x` |

`main` is production-ready. `develop` is the integration branch. Never push directly to `main`.

---

## Commit Format

```
type(scope): description
```

**Types:**

| Type | When to use |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code improvement with no behaviour change |
| `test` | Test additions or fixes |
| `docs` | Documentation only |
| `chore` | Dependency updates, config changes |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |
| `merge` | Merge commits |

Rules:
- Keep the description under 50 characters
- Use imperative mood: "add" not "added"
- No period at the end
- Reference issue numbers when applicable: `fix(#456): resolve...`

---

## Adding a New Tool

Tools live in `src/agent/tools/`. Each tool implements the `Tool` interface from `src/types/index.ts`:

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema']; // JSON Schema object
  execute(input: ToolInput): Promise<string>;
}
```

Steps:

1. **Create the tool file** in `src/agent/tools/my_tool.ts`. Export a `Tool` object or a factory function (use a factory if the tool needs configuration like a project root).

2. **Apply sandboxing if the tool accesses the filesystem**. Import the `sandboxPath` pattern from `files.ts` — all path arguments must be validated against the project root before use.

3. **Register the tool** in `src/cli/index.ts` inside `buildRegistry()`:
   ```ts
   registry.register(myTool);
   // or for factories:
   registry.register(createMyTool(config));
   ```

4. **Write tests** in `src/__tests__/my_tool.test.ts`. Cover:
   - Normal execution
   - Error cases (invalid input, execution failures)
   - Sandbox escape attempts if the tool accesses files

5. **Document the tool** in `docs/API.md` under the MCP Tools section.

---

## Adding a New SSE Event

SSE events are the primary way the backend communicates with the web console. To add a new event type:

1. **`src/server/events.ts`** — add a new member to the `SseEvent` union:
   ```ts
   | { type: 'my_event'; fieldA: string; fieldB: number }
   ```

2. **`src/server/index.ts`** — emit the event from the appropriate place in the `POST /api/chat` handler using the `send()` helper.

3. **`web/src/types.ts`** — mirror the new event type in the web-side `SseEvent` union (the two files are kept in sync manually).

4. **`web/src/App.tsx`** — handle the new event in the `streamChat` callback inside `handleSubmit`. The `sseEventToChatItem()` function converts events to `ChatItem` values for rendering; update it if the event should appear in the chat timeline.

---

## Adding a New Environment Variable

1. **`src/config/index.ts`** — add the variable to the `ConfigSchema` Zod object with a sensible default and a corresponding `process.env` read in `loadConfig()`.

2. **`src/types/index.ts`** — if the new config field is part of `KoaConfig` (the type inferred from the schema), it appears automatically. If you need a separate interface field, add it there.

3. **`README.md`** — add a row to the Environment Variables table.

4. Write a test in `src/__tests__/config.test.ts` covering the default value and the env-var override.

---

## Pull Request Checklist

Before opening a PR:

- [ ] Branch is up to date with `develop` (rebase or merge)
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — zero warnings
- [ ] No `console.log`, debug code, or commented-out code
- [ ] No secrets or API keys in any file
- [ ] Commit history is clean (squash micro-commits)
- [ ] New behaviour is covered by tests
- [ ] If the change affects the API, `docs/API.md` is updated
