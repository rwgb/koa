# Contributing to Koa

Koa is a personal project. This document describes the development workflow and the patterns you need to follow when extending the system.

---

## Setup

```bash
git clone git@github.com:rwgb/koa.git
cd koa
./install.sh
```

The install script installs all dependencies, compiles TypeScript, builds the Vite web console, links the `koa` binary globally, and wires git hooks. See `README.md` for install flags.

---

## Dev Workflow

Run the backend and Vite dev server in separate terminals:

```bash
# Terminal 1 — Express + AgentLoop, hot-reload via tsx watch
npm run dev

# Terminal 2 — Vite dev server, /api proxied to port 3000
cd web && npm run dev
```

Open `http://localhost:5173` for the web console. The TUI (`koa chat`) does not need the Express server — `npm run dev` alone is sufficient.

---

## Testing

```bash
npm test                  # Run the full suite once
npm run test:watch        # Watch mode — reruns affected tests on save
npm run test:coverage     # Coverage report
npm run typecheck         # tsc --noEmit, zero tolerance
npm run lint              # ESLint
npm run lint:fix          # Auto-fix lint issues
npm run format            # Prettier
```

All tests live in `src/__tests__/`. Test files follow the pattern `<subject>.test.ts`. The test runner is Vitest. Do not commit with failing tests or type errors.

---

## Pipeline Gates

Every change must pass these stages in order before being committed:

| Stage | What passes |
|-------|-------------|
| **Coding** | Architecture reviewed; implementation complete |
| **UI/UX** | Any affected frontend path works in the browser |
| **QA** | `npm run typecheck` = 0 errors, `npm test` = all pass, `npm run lint` = 0 warnings |
| **Security** | No HIGH/MEDIUM findings in the diff |
| **Docs** | DEVLOG.md, inline comments for non-obvious decisions, affected docs updated |

Skipping a stage is allowed only if it doesn't apply (e.g., no UI for a backend-only change). Document the skip.

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

| Type | When to use |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code improvement, no behaviour change |
| `test` | Test additions or fixes |
| `docs` | Documentation only |
| `chore` | Dependency updates, config changes |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |

Rules: description under 50 characters, imperative mood ("add" not "added"), no trailing period. Reference issues: `fix(#456): resolve...`

---

## Code Style

- 2-space indentation (TypeScript/JavaScript)
- ESLint + Prettier non-negotiable — run `npm run lint` and `npm run format` before committing
- No `console.log` in production paths — use `process.stderr.write()` for diagnostics
- No swallowed exceptions — propagate with context
- Explicit `unknown` narrowing before use (TypeScript strict mode)
- Match existing file style even if you would do it differently

---

## Adding a New Tool

Tools live in `src/agent/tools/`. Each tool implements the `Tool` interface:

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema']; // JSON Schema
  execute(input: ToolInput): Promise<string>;
}
```

Steps:

1. **Create** `src/agent/tools/my_tool.ts`. Export a `Tool` object, or a factory function if the tool needs configuration (like a project root).

2. **Sandbox filesystem access**. If the tool reads or writes files, copy the `sandboxPath()` pattern from `files.ts`. Every path argument must be validated against the project root before any filesystem operation.

3. **Register** in `src/cli/index.ts` inside `buildRegistry()`:
   ```ts
   registry.register(myTool);
   // factory tools:
   registry.register(createMyTool(config));
   ```

4. **Test** in `src/__tests__/my_tool.test.ts`. Cover normal execution, error cases, and sandbox escape attempts if the tool touches files.

5. **Document** the tool in `docs/TOOLS.md`.

---

## Writing a Plugin

Plugins are JSON manifests dropped in `~/.koa/plugins/`. They are loaded at server startup and registered as agent tools. No code compilation required.

See `docs/PLUGINS.md` for the full manifest format and transport options. The short version:

```json
{
  "name": "my_plugin",
  "version": "1.0.0",
  "description": "My plugin",
  "tools": [
    {
      "name": "my_tool",
      "description": "Does something",
      "transport": "bash",
      "config": {
        "command": "echo \"$INPUT_VALUE\"",
        "env": { "INPUT_VALUE": "{{input.value}}" }
      }
    }
  ]
}
```

Drop it at `~/.koa/plugins/my_plugin.json` and restart the server.

---

## Writing a Custom Skill

Custom skills are the web-console equivalent of plugins — bash or HTTP tools you create through the Settings → Skills UI without touching JSON files directly.

They are stored at `~/.koa/custom-skills.json` and follow the same `bash`/`http` transport model as plugins. You can also create them via the REST API:

```bash
curl -X POST http://localhost:3000/api/admin/skills/custom \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ping_service",
    "description": "Ping a homelab service",
    "type": "bash",
    "config": {
      "command": "curl -sf \"http://$TARGET_HOST/health\"",
      "env": { "TARGET_HOST": "{{input.host}}" }
    }
  }'
```

---

## Adding a New Channel (Slack/SMS/etc.)

Channels are incoming message sources that route to the agent loop. The existing pattern (see `src/channels/`):

1. **Validate the inbound request** — check signatures/tokens specific to the channel provider.
2. **Parse the inbound message** — extract the user's text into a plain string.
3. **Deduplicate** — use `isDuplicate` / `markProcessed` from `src/channels/dedup.ts` to prevent double-processing.
4. **Call `loop.turn(message)`** — the agent loop is channel-agnostic.
5. **Reply** — send the agent's response back to the channel.

Wire the new router in `src/server/routes/webhooks.ts` and mount it in `src/server/index.ts`.

---

## Adding a New SSE Event

SSE events are the real-time channel between the Express backend and the React web console.

1. **`src/server/events.ts`** — add a member to the `SseEvent` discriminated union:
   ```ts
   | { type: 'my_event'; fieldA: string; fieldB: number }
   ```

2. **`src/server/routes/chat.ts`** — emit from the appropriate `runChatStream` callback.

3. **`web/src/types.ts`** — mirror the event type in the web-side `SseEvent` union (kept in sync manually).

4. **`web/src/App.tsx`** — handle the event in `handleSubmit`. Update `sseEventToChatItem()` if the event should appear in the chat timeline.

---

## Adding a New Environment Variable

1. **`src/config/index.ts`** — add to the Zod `ConfigSchema` with a sensible default and a `process.env` read in `loadConfig()`.

2. **`src/types/index.ts`** — if the field is part of `KoaConfig`, it appears automatically.

3. **`.env.example`** — add a commented entry.

4. **`README.md`** — add a row to the Environment Variables table.

5. **Test** in `src/__tests__/config.test.ts` covering default value and env-var override.

---

## Pull Request Checklist

- [ ] Branch is up to date with `develop` (rebase or merge)
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — zero warnings
- [ ] No `console.log`, debug code, or commented-out code
- [ ] No secrets or API keys in any committed file
- [ ] Commit history is clean (squash micro-commits)
- [ ] New behaviour is covered by tests
- [ ] Affected docs updated (`docs/API.md`, `docs/TOOLS.md`, etc.)
- [ ] DEVLOG.md updated with decisions made
