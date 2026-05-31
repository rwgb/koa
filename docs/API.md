# Koa API Reference

This document covers the HTTP REST endpoints exposed by `koa web` and the MCP tools registered by `koa mcp`.

---

## REST Endpoints

The Express server is created in `src/server/index.ts`. It listens on port 3000 by default (configurable with `--port`).

CORS is restricted to `http://localhost:5173` (the Vite dev server). The built web UI is served from the same origin as the Express server, so no CORS header is needed in production.

---

### `GET /api/context`

Returns the current agent state for initial hydration when the web console connects.

**Response** (`Content-Type: application/json`):

```json
{
  "context": {
    "goal": "string | undefined",
    "hotFiles": [
      { "path": "string", "score": "number", "cluster": "string | undefined" }
    ],
    "masterFiles": ["string"],
    "sessionSummary": "string | undefined"
  },
  "model": "string",
  "turnCount": "number",
  "engramEnabled": "boolean",
  "activeModel": "string",
  "activeTier": "string",
  "usage": {
    "inputTokens": "number",
    "outputTokens": "number",
    "cacheWriteTokens": "number",
    "cacheReadTokens": "number",
    "estimatedCostUsd": "number",
    "cacheHitRate": "number",
    "turnsCount": "number"
  }
}
```

Field notes:

- `context` — the `EngramContext` loaded from the Engram brain at startup. All fields are empty/undefined if Engram is disabled or no brain exists.
- `model` — the configured default model (`KOA_MODEL` or CLI `--model` flag).
- `activeModel` — the model actually used on the last turn (may differ from `model` when smart routing or a `@tier:` override is active). Defaults to `model` if no turn has been completed yet.
- `activeTier` — `"haiku"`, `"sonnet"`, or `"opus"`. Defaults to `"sonnet"`.
- `usage` — cumulative session token usage. All counts are zero on the first connect.

---

### `POST /api/chat`

Sends a user message to the agent and streams the response as Server-Sent Events.

**Request body** (`Content-Type: application/json`):

```json
{
  "message": "string"
}
```

The `message` field is required and must be non-empty after trimming. A missing or blank `message` returns HTTP 400.

**Concurrent requests**: only one turn can be active at a time. A second `POST /api/chat` while a turn is in progress returns HTTP 429:

```json
{
  "error": "Agent is busy — wait for the current response to finish"
}
```

**Successful response**: HTTP 200 with `Content-Type: text/event-stream`. Events are emitted as:

```
data: <JSON>\n\n
```

The stream ends when the response is closed (after the `done` event, or immediately after an `error` event).

#### SSE Event Types

All events share a `type` discriminant. The browser can parse them by splitting on `\n\n` and stripping the `data: ` prefix from each chunk.

---

##### `tool_call`

Emitted before each tool executes.

```json
{
  "type": "tool_call",
  "name": "string",
  "input": { "...": "..." }
}
```

- `name` — the registered tool name (`bash`, `read_file`, `write_file`, `edit_file`, `grep`, `engram_query`).
- `input` — the raw arguments object the model supplied.

---

##### `tool_result`

Emitted after each tool returns.

```json
{
  "type": "tool_result",
  "name": "string",
  "result": "string"
}
```

- `result` — the string returned by `tool.execute()`. May be truncated to `KOA_MAX_TOOL_OUTPUT` characters with a `[truncated — N total chars]` sentinel appended.

---

##### `content`

Emitted once per turn with the full assistant text response (after all tool calls are complete).

```json
{
  "type": "content",
  "text": "string"
}
```

---

##### `usage`

Emitted after `content`, before `done`. Contains per-turn and cumulative session token statistics.

```json
{
  "type": "usage",
  "turn": {
    "inputTokens": "number",
    "outputTokens": "number",
    "cacheWriteTokens": "number",
    "cacheReadTokens": "number",
    "model": "string"
  },
  "session": {
    "inputTokens": "number",
    "outputTokens": "number",
    "cacheWriteTokens": "number",
    "cacheReadTokens": "number",
    "estimatedCostUsd": "number",
    "cacheHitRate": "number",
    "turnsCount": "number"
  }
}
```

- `turn` — token counts for this turn only. Multiple API calls within one turn (due to tool-use loops) are summed into a single `turn` object.
- `session` — cumulative totals across all turns since the server started.
- `cacheHitRate` — `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)` as a value between 0 and 1.
- `estimatedCostUsd` — computed from per-category pricing keyed by model prefix.

---

##### `done`

Emitted as the final event of every successful turn.

```json
{
  "type": "done",
  "turnCount": "number",
  "model": "string",
  "tier": "string"
}
```

- `turnCount` — total number of completed turns in this session.
- `model` — the model ID that was used for this turn.
- `tier` — `"haiku"`, `"sonnet"`, or `"opus"`.

---

##### `error`

Emitted if the agent throws an unhandled error. The stream closes after this event.

```json
{
  "type": "error",
  "message": "Agent error — see server logs"
}
```

The error message is intentionally sanitised. Full error details are logged to the server console only.

---

## MCP Tools

`koa mcp` registers the following tools with the MCP server. They are available to any MCP client (e.g., Claude Desktop) that connects over stdio.

All file tools are sandboxed to the `--project` path supplied on the command line. Any attempt to access a path outside the project root throws an `"Access denied"` error.

---

### `bash`

Execute a shell command in a `bash -c` subprocess.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | yes | The shell command to run |
| `timeout` | `number` | no | Timeout in milliseconds (default: 30000) |

**Behaviour:**

- The `timeout` value is clamped to `[1000, 300000]` (1 second minimum, 5 minute maximum). The model cannot specify a longer timeout.
- Both stdout and stderr are captured. If the exit code is non-zero and stderr is non-empty, the output is formatted as `Exit <code>\n<stdout>\nSTDERR: <stderr>`.
- If the command produces no output, the result is `(exit <code>)`.

---

### `read_file`

Read the contents of a file within the project, with optional line range.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | yes | Absolute or relative path to the file |
| `offset` | `number` | no | Line number to start reading from (1-indexed, default: 1) |
| `limit` | `number` | no | Maximum number of lines to read |

**Behaviour:**

- Returns the file content with line numbers prefixed (`<n>\t<line>`), matching the format used by Claude Code's Read tool.
- `offset` and `limit` work together: `offset=10, limit=20` returns lines 10–29.
- Without `limit`, reads to the end of the file.

---

### `write_file`

Write content to a file within the project, creating the file and any intermediate directories if needed.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | yes | Path to the file |
| `content` | `string` | yes | Content to write |

**Behaviour:**

- Overwrites the file if it already exists.
- Creates parent directories with `mkdir -p` semantics.
- The directory target is also sandbox-checked before `mkdir` runs.
- Returns `Wrote N bytes to <path>` on success.

---

### `edit_file`

Replace an exact string in a file.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | yes | Path to the file |
| `old_string` | `string` | yes | Exact string to find and replace |
| `new_string` | `string` | yes | Replacement string |

**Behaviour:**

- Reads the entire file, performs a single `String.replace(oldStr, newStr)` (replaces only the first occurrence).
- Throws `"old_string not found in file"` if `old_string` does not appear in the file.
- Returns `Edited <relative-path>` on success.

---

### `grep`

Search for a pattern in files within the project using the system `grep` binary.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | `string` | yes | Search pattern (regex supported) |
| `path` | `string` | no | File or directory to search in (defaults to project root) |
| `include` | `string` | no | File glob pattern to restrict results (e.g., `"*.ts"`) |

**Behaviour:**

- Runs `grep -r --line-number <pattern> <path> [--include <include>]`.
- The search path is sandbox-checked before the subprocess runs.
- Returns matching lines in `grep` format (`file:line:match`), or `(no matches)` if the pattern is not found.

---

### `engram_query`

Search project memory (Engram) for context about files, decisions, or history.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | yes | Search terms to query Engram memory |

**Behaviour:**

- Calls `python3 ~/.claude/skills/engram/cli/engram.py query -- <query> --project <projectPath>`.
- The `--` sentinel before the query prevents flag injection if the query starts with `-`.
- Returns the Engram CLI output as a string.
- Returns `(no results found in Engram memory)` if the query matches nothing, or if no Engram brain exists for the project.
