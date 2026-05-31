# Koa — Architecture

## System Overview

```
                         ┌──────────────────────────────────┐
                         │           Koa Process            │
                         │                                  │
  ┌─────────┐  message   │  ┌──────────────────────────┐   │
  │  TUI    │──────────► │  │       AgentLoop          │   │
  │  (Ink)  │◄────────── │  │  initialize/turn/finalize│   │
  └─────────┘  content   │  └──────────┬───────────────┘   │
                         │             │                    │
  ┌─────────┐  POST/SSE  │             │  Anthropic SDK     │
  │   Web   │──────────► │             ▼                    │
  │ Console │◄────────── │  ┌────────────────────┐         │──► Anthropic API
  │(React)  │  SseEvent  │  │   ToolRegistry     │         │
  └─────────┘            │  │ bash | files | engram_query │ │
                         │  └──────────┬───────────────────┘│
  ┌─────────┐  JSON-RPC  │             │                    │
  │ Claude  │──────────► │  ┌──────────▼───────────┐       │
  │ Desktop │◄────────── │  │    EngramClient       │       │──► ~/.engram/brains/
  │  (MCP)  │  tool resp │  │  (Python subprocess)  │       │
  └─────────┘            │  └───────────────────────┘       │
                         └──────────────────────────────────┘
```

The three frontends share the same `AgentLoop`, `ToolRegistry`, and `EngramClient` instances. The TUI and web console call `loop.turn()` directly (or via HTTP). MCP gives Claude Desktop direct access to the registered tools without routing messages through the agent loop.

---

## Agent Loop

**File**: `src/agent/loop.ts`

The loop has three lifecycle phases:

### `initialize()`

1. If Engram is enabled, calls `engram.sync(projectPath)` to pull the latest brain state.
2. Calls `engram.getContext()` to load hot files, master files, goal, and last session summary into `state.engramContext`.
3. Calls `engram.startSession(goal)` to open a tracked session in the brain.

### `turn(userMessage, callbacks?)`

1. Runs `selectModel()` to resolve the model for this turn (strips any `@tier:` prefix from the message; see Smart Model Routing).
2. Appends `{ role: 'user', content: cleanMessage }` to `state.messages`.
3. Builds a system prompt as a cached `TextBlockParam` array:
   - The base system prompt is always the first element.
   - `engram.buildSystemPromptInjection()` appends the `<engram_context>` XML block when context is available.
   - The entire system prompt carries `cache_control: { type: 'ephemeral' }` so Anthropic caches it for 5 minutes.
4. Applies `cache_control: { type: 'ephemeral' }` to the last tool in the tool list (caches the full tool definition array).
5. Enters a **tool-use while loop**:
   - Calls `client.messages.create()` with the current message history.
   - Accumulates `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` from every API response.
   - If `stop_reason === 'tool_use'`:
     - Iterates over `response.content` blocks of type `tool_use`.
     - Looks up each tool in the registry; calls `tool.execute(input)`.
     - Fires `callbacks.onToolCall` and `callbacks.onToolResult` (used by the web SSE route to stream events to the browser).
     - Truncates output longer than `config.maxToolOutputChars` and appends `[truncated — N total chars]` so the model knows the result was cut.
     - Pushes a `tool_result` message and loops.
   - If `stop_reason !== 'tool_use'`, exits the loop and extracts `finalContent` from the text blocks.
6. Calls `usage.addTurn()` with the accumulated token counts.
7. Calls `maybeCompact()` to slide the conversation window.
8. Returns a `TurnResult` with `content`, `toolUses`, `stopReason`, `model`, `tier`, and `usage`.

### `finalize()`

Calls `engram.rememberSession(summary)` to persist a brief session summary to the brain. Skipped if Engram is disabled or if no turns were completed.

### Conversation Compaction

`maybeCompact()` drops the oldest messages whenever `state.messages.length` exceeds `compactAfterTurns * 2`. The system prompt is never in `messages[]` — it is built fresh each turn — so it is never dropped. Conversational context (e.g., earlier instructions or file contents) can be lost at the window boundary. This is an acknowledged trade-off over more expensive summarisation.

---

## Smart Model Routing

**File**: `src/agent/router.ts`

### Model Tiers

| Tier | Model ID |
|------|----------|
| `haiku` | `claude-haiku-4-5-20251001` |
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-7` |

### Per-Turn Override

`extractTierOverride(message)` checks whether the message begins with `@haiku:`, `@sonnet:`, or `@opus:` (case-insensitive). If matched, the prefix is stripped and the corresponding model is used unconditionally for that turn, bypassing the classifier entirely.

### `classifyMessage(message, recentToolUseCount)`

Runs only when `KOA_SMART_ROUTING=true`. Classification rules (evaluated in order):

1. `recentToolUseCount >= 3` → `complex`
2. Message matches `COMPLEX_RE` (`refactor|architect|design|implement|optimize|rewrite|migrate|build|create a|add a|fix|debug`) OR length > 400 chars → `complex`
3. Length > 120 chars OR does NOT match `SIMPLE_RE` (`what|who|where|when|show|list|get|find|check|is|does|can|how many|tell me`) → `moderate`
4. Otherwise → `simple`

### `selectModel(message, recentToolUseCount, config)`

1. Checks for a tier override prefix. If present, returns that model immediately.
2. If `config.smartRouting` is `false`, returns `config.model` unchanged (the tier label is inferred from the model ID for display purposes).
3. Otherwise calls `classifyMessage()` and maps `simple → haiku`, `moderate → sonnet`, `complex → opus`.

Smart routing is **off by default** (`KOA_SMART_ROUTING` not set). This prevents unexpected model changes for existing sessions.

---

## Token Usage Tracking

**File**: `src/agent/usage.ts`

### `PRICING` Map

Keyed by model prefix (`claude-haiku`, `claude-sonnet`, `claude-opus`). Prefixes are sorted by length descending to prevent `claude-haiku` matching before `claude-haiku-4-5-20251001`. A `default` entry (Sonnet rates) covers any unrecognised model. This design means new model versions (e.g., `claude-sonnet-4-99`) inherit correct rates without a code change.

### `UsageTracker`

Injected into `AgentLoop` as a constructor dependency (not a singleton). This keeps tests isolated and supports future multi-session use.

`addTurn(usage: TurnUsage)`:
- Accumulates `inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens` across all API calls within one logical turn.
- Recomputes `estimatedCostUsd` using per-category per-million-token pricing.
- Recomputes `cacheHitRate` as `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)`.

`getStats()` returns a `SessionUsageStats` snapshot: all token counts, `estimatedCostUsd`, `cacheHitRate`, and `turnsCount`.

### SSE vs REST Delivery

- The **`usage` SSE event** delivers per-turn and cumulative session stats after every `turn()` completes. The web UI updates the sidebar in real time.
- **`GET /api/context`** includes `usage: state.usage` in its response body so the web console can hydrate session totals on initial connect without waiting for the first turn.

---

## Tool System

**File**: `src/agent/tools/registry.ts`, `src/agent/tools/`

### `ToolRegistry`

A `Map<string, Tool>` with `register()`, `get()`, and `getAll()` methods. `toAnthropicTools()` serialises all registered tools to the Anthropic SDK format (`name`, `description`, `input_schema`).

### File Tool Sandbox

`createFileTools(projectRoot)` is a factory that closes over `projectRoot`. Every file operation (`read_file`, `write_file`, `edit_file`, `grep`) calls `sandboxPath(rawPath, projectRoot)` before any filesystem access:

```
resolved = path.resolve(rawPath)
root     = path.resolve(projectRoot)
if resolved !== root && !resolved.startsWith(root + path.sep) → throw "Access denied"
```

`write_file` additionally sandboxes the `mkdir` target directory. This prevents path traversal (e.g., `../../etc/passwd`).

### Engram `--` Sentinel

`EngramClient` passes `--` before all user-supplied positional arguments in every `execa` call. This prevents flag injection if a query term or summary happens to start with `-`.

---

## MCP Server Mode

**File**: `src/server/mcp.ts`

### Transport

Uses `@modelcontextprotocol/sdk` with `StdioServerTransport`. Communication is JSON-RPC 2.0 over stdio.

### `toMcpInputSchema(tool)`

Converts Koa's JSON Schema tool definitions (plain objects with `properties` and `required` arrays) into Zod shapes required by the MCP SDK's `registerTool()`. Supported types: `string`, `number`, `boolean`; all others fall back to `z.unknown()`. Optional fields use `.optional()`.

### Why `AgentLoop` Is Not Exposed

Exposing the agent loop as an MCP tool would create a recursive Claude-calls-Claude situation (Claude Desktop → Koa MCP → AgentLoop → Anthropic API → Claude). The design decision is to expose only the primitives: bash execution, file operations, and Engram queries. Claude Desktop composes them directly.

### Stdout Discipline

The stdio transport owns stdout entirely for JSON-RPC framing. All diagnostic output in the `koa mcp` command path is written to `stderr`. The `startMcpServer()` function writes its startup message with `process.stderr.write()`.

---

## SSE Streaming

**File**: `src/server/events.ts`, `src/server/index.ts`

### `SseEvent` Discriminated Union

| `type` | Payload fields | When emitted |
|--------|---------------|--------------|
| `tool_call` | `name: string`, `input: Record<string, unknown>` | Before each tool executes |
| `tool_result` | `name: string`, `result: string` | After each tool returns |
| `content` | `text: string` | Once per turn with the full assistant text response |
| `done` | `turnCount: number`, `model: string`, `tier: string` | After all events for a turn |
| `usage` | `turn: TurnUsage`, `session: SessionUsageStats` | After `content`, before `done` |
| `error` | `message: string` | On agent error (sanitised; no paths or stack traces) |

### Wire Format

Each event is written as:

```
data: <JSON>\n\n
```

The browser side (`web/src/api.ts`) reads the `ReadableStream` manually with `getReader()`, decodes with `TextDecoder`, and splits on `\n\n`. The browser `EventSource` API is not used because it does not support `POST` requests with a body.

### `isBusy` Mutex

A single `boolean` flag prevents concurrent turns. `POST /api/chat` returns HTTP 429 if `isBusy` is `true`. When the client disconnects mid-stream, `req.on('close')` sets `disconnected = true` and clears `isBusy` immediately so the next request is not blocked. A `disconnected` guard prevents writing to the closed response after the flag is set.

---

## Engram Integration

**File**: `src/engram/client.ts`

### `buildSystemPromptInjection(ctx: EngramContext)`

Returns an XML block injected into the system prompt:

```xml
<engram_context>
## Session Goal
<goal text>

## Hot Files (most relevant to this project)
- src/agent/loop.ts [agent-core]
- src/server/index.ts

## Key Files
- ARCHITECTURE.md

## Previous Session
<session summary text>
</engram_context>
```

The block is omitted entirely if `ctx` contains no data (empty hot files, no goal, no summary). Up to 10 hot files are included, ordered by Engram's relevance score. Hot files may include an optional `[cluster]` label from Engram's clustering.

### Availability Check

`EngramClient` checks two conditions before any operation:
1. The Engram CLI exists at `~/.claude/skills/engram/cli/engram.py`
2. A brain database exists at `~/.engram/brains/<slug>/brain.db`

The slug is derived from the project path by replacing non-alphanumeric characters with hyphens. If either condition is false, all methods return empty values and the session continues without memory.

---

## Security Model

### File Sandbox

All file tool operations are restricted to `config.projectPath` via `sandboxPath()`. The factory pattern ensures the root cannot be changed after registration without creating a new registry.

### CORS

The Express server allows requests only from `http://localhost:<devPort>` (default `5173`). Wildcard CORS (`*`) is explicitly rejected. This is a hard security requirement: the `bash` tool gives full shell access, so a wildcard CORS policy combined with a malicious page loaded in the same browser would constitute a drive-by RCE vector.

The built web UI is served as static files from the same origin as the Express server, so no CORS header is needed for production use.

### Error Scrubbing at SSE Boundary

Agent errors are logged in full to the server console (`console.error`). The SSE client receives only `"Agent error — see server logs"`. This prevents leaking filesystem paths, stack frames, or other system details to the browser.

### Bash Timeout Clamping

The `bash` tool clamps the caller-supplied `timeout` to `[1000ms, 300000ms]`. The model cannot specify an arbitrarily long timeout.

---

## Web Frontend

**Directory**: `web/`

Built with Vite 5 and React 18. TypeScript strict mode with `noUnusedLocals`, `noUnusedParameters`, and `exactOptionalPropertyTypes`.

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `App.tsx` | Top-level state (items, status, isThinking, input, sessionUsage); routes SSE events; calls `fetchStatus()` on mount |
| `StatusBar` | Model name, active tier badge (color-coded), turn count, cost pill, braille spinner during thinking |
| `Sidebar` | Engram goal, hot files (up to 8), master files, previous session summary, full token usage breakdown |
| `ChatPanel` | Scrollable message list, Enter-to-submit text input |
| `MessageBubble` | Per-type rendering; tool calls and tool results are collapsible by default |

### SSE Parsing (Manual, Not EventSource)

`web/src/api.ts` implements `streamChat()` using `fetch()` with a `ReadableStream` reader. The `EventSource` API cannot send a `POST` request with a JSON body, so the SSE stream is parsed manually by splitting decoded chunks on `\n\n` and extracting the `data: ` prefix.

### Vite Dev Proxy

During development, `vite.config.ts` proxies `/api` requests to `http://localhost:3000`, allowing the Vite dev server (port 5173) and the Express API server (port 3000) to run in separate terminals without CORS issues.

### CSS Strategy

All styles are in `web/src/index.css` using CSS custom properties for the dark terminal theme. No per-component CSS files, no CSS-in-JS. This keeps theming centralised and avoids Vite config complexity.
