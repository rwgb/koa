# Koa Agent Tools Reference

All tools below are registered in the `ToolRegistry` and available to the agent during a conversation. Each tool is documented with its parameters, return value, and any security constraints.

---

## File System Tools

File tools are created by `createFileTools(projectRoot)` — a factory that closes over the project root. Every path argument is validated against the project root by `sandboxPath()` before any filesystem operation. Attempting to access a path outside the root throws an `Access denied` error and the tool call fails.

### `read_file`

Read the contents of a file within the project sandbox.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute or relative path to the file |
| `offset` | number | No | Line number to start reading from (1-indexed, default: 1) |
| `limit` | number | No | Maximum number of lines to read |

**Returns:** Line-numbered file contents in `N\tline` format.

**Security:** Path is sandboxed to project root. Cannot traverse outside.

```
read_file({"path": "src/agent/loop.ts", "offset": 1, "limit": 50})
```

---

### `write_file`

Write content to a file within the project, creating it if it does not exist. Creates parent directories as needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to the file |
| `content` | string | Yes | Content to write |

**Returns:** `"Wrote N bytes to /absolute/path"`

**Security:** Both the file path and parent directory are sandboxed to project root.

---

### `edit_file`

Replace an exact string in a file. Fails if `old_string` is not found.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to the file |
| `old_string` | string | Yes | Exact string to find and replace |
| `new_string` | string | Yes | Replacement string |

**Returns:** `"Edited relative/path/to/file"`

**Note:** Only the first occurrence of `old_string` is replaced.

---

### `grep`

Search for a pattern in files within the project using `grep -r --line-number`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | Yes | Search pattern (regex supported) |
| `path` | string | No | File or directory to search (defaults to project root) |
| `include` | string | No | File glob filter (e.g. `"*.ts"`) |

**Returns:** Matching lines with file paths and line numbers, or `"(no matches)"`.

**Security:** Search path is sandboxed to project root.

---

### `analyze_image`

Read an image file from disk and return it for Claude's vision analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the image file |

**Returns:** A multimodal result containing the base64-encoded image and a text label.

**Supported types:** `jpg`, `jpeg`, `png`, `gif`, `webp`

**Note:** Unlike other file tools, this tool is NOT sandboxed to the project root — it accepts any absolute path. This is intentional because users frequently want to analyze screenshots from their desktop.

---

## Shell Tool

### `bash`

Execute a shell command in the project directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | The shell command to execute |
| `timeout` | number | No | Timeout in milliseconds (default: 30000) |

**Returns:** Combined stdout + stderr output. On non-zero exit, prefixes with `Exit N`.

**Security:** Timeout is clamped to `[1000ms, 300000ms]` — the model cannot specify an arbitrarily long or short timeout. Commands execute as the server process user with full filesystem access (this is intentional for a personal assistant). Do not expose `koa web` to untrusted networks.

```
bash({"command": "git log --oneline -10"})
bash({"command": "npm test", "timeout": 120000})
```

---

## Code Execution Tool

### `execute_code`

Run a code snippet and return stdout, stderr, and exit code. The sandbox backend is configured by `KOA_SANDBOX_BACKEND` (`local` or `docker`). Docker mode wraps the execution in `docker run --rm --network=none`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `language` | string | Yes | `javascript`, `python`, or `bash` |
| `code` | string | Yes | The code to execute |

**Returns:**

```
exit_code: 0
timed_out: false

--- stdout ---
Hello, world

--- stderr ---
(empty if no error output)
```

**Security:**
- Local backend: runs as the server process user; inherits `process.env` (user controls the code)
- Docker backend: `--network=none`, memory and CPU limits, read-only filesystem
- Timeout from `KOA_SANDBOX_TIMEOUT_MS` (default 10 s)
- Output truncated at 50 KB

---

## Web Tools

### `web_search`

Search the web using the Brave Search API. Requires `BRAVE_API_KEY` configured in credentials.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (1–500 characters) |
| `count` | number | No | Number of results (1–10, default 8) |

**Returns:** Numbered list of results with title, URL, and snippet.

**Security:** Reaches only `api.search.brave.com`. 10 s timeout.

```
web_search({"query": "Playwright headless browser Node.js", "count": 5})
```

---

### `web_fetch`

Fetch a URL and return its content as clean Markdown via Jina Reader (`r.jina.ai`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | The HTTPS URL to fetch (max 2048 chars) |

**Returns:** Markdown content, truncated at 50 KB.

**Security:** SSRF-guarded — private IP ranges, loopback, link-local, and non-HTTPS URLs are blocked. All requests go through Jina Reader, which does not expose the raw URL to the agent. 20 s timeout.

---

## Browser Automation Tools

Browser tools require Playwright with Chromium installed. Check availability with `GET /api/admin/browser/status`. If Playwright is not installed, all browser tools return a message instructing the user to install it.

All browser tools share a single persistent browser instance (singleton). The SSRF guard blocks private IP ranges and non-HTTPS URLs before reaching Playwright.

### `browser_navigate`

Navigate to a URL and return the page title.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | HTTPS URL to navigate to |

**Returns:** `"Navigated to: <page title>"`

**Security:** SSRF guard enforced at both the tool layer and the action layer. 15 s timeout.

---

### `browser_extract`

Extract visible text from the current page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | No | CSS selector to scope extraction (default: `body`) |

**Returns:** Text content, truncated at 20 KB.

---

### `browser_screenshot`

Take a full-page screenshot.

**Parameters:** None

**Returns:** `data:image/png;base64,<data>` — compatible with Claude's vision input.

**Security:** Screenshots capture full rendered DOM state. 2 MB cap.

---

### `browser_fill`

Fill form fields on the current page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fields` | object | Yes | Map of CSS selectors to string values |

**Returns:** `"Form filled"` on success.

---

### `browser_click`

Click an element on the current page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | Yes | CSS selector of the element to click |

**Returns:** `"Clicked: <selector>"`

---

## Memory Tools

### `remember`

Save a fact to persistent global memory (`~/.koa/memory.json`). Available in all future sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fact` | string | Yes | The fact to remember, as a complete self-contained sentence |

**Returns:** `"Remembered: \"<fact>\""`

```
remember({"fact": "Koa's project root is /home/user/projects/koa"})
```

---

### `forget`

Remove a previously saved memory. Matches by substring — any stored memory containing the given text is removed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fact` | string | Yes | Text to match against stored memories |

**Returns:** Confirmation or "No memories matched" message.

---

### `engram_query`

Search the Engram project index by file-path keyword. Searches are against file path segments, not code content. Requires an Engram brain to be indexed for the project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search terms (e.g. `"router"`, `"agent loop"`) |

**Returns:** Matching source files with cluster labels and dependency counts, or `"(no results found)"`.

**Security:** Engram CLI is called with `--` before all user-supplied arguments to prevent flag injection.

---

## SpiderBrain Tools

SpiderBrain tools operate on a static dependency graph (`synganglion.json`) built from the project's source files. These tools require the SpiderBrain brain to be configured (`SPIDERBRAIN_BRAIN` env var or `spiderBrainBrain` config setting).

### `spiderbrain_query`

Search the dependency graph for files, clusters, or concepts. Results are ranked by webscore × recency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `terms` | string | Yes | Search terms |

**Returns:** Ranked list of matching nodes.

---

### `spiderbrain_cascade`

Simulate a fault at a file and show which other files would be affected (blast radius analysis). Run before editing high-mass files.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `node_id` | string | Yes | File path (node ID) to simulate a fault at |

**Returns:** Cascade analysis showing dependent files and estimated impact.

---

### `spiderbrain_molt`

Run a drift audit: surfaces orphaned files, dangling dependency edges, and stale webscore divergence.

**Parameters:** None

**Returns:** Audit report.

---

## Agent Dispatch Tool

### `dispatch_agent`

Spawn a specialist sub-agent. The agent receives a task and returns structured Markdown output. The agent template is loaded from `~/claudeAgents/tools/agent-templates/<name>.md`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Agent name: `architect`, `reviewer`, `debug`, `security-reviewer` |
| `task` | string | Yes | Task description (be specific) |
| `context` | string | No | Additional context |

**Returns:** Agent output (Markdown), truncated at 8000 characters.

**Security:** Only the four agents in the allowlist can be dispatched — the model cannot call arbitrary agents. Uses Haiku for cost efficiency.

**Side effect:** Writes `HANDOFF.md` in the project memory directory with dispatch status (`RUNNING → PASS/FAIL`).

---

## GitHub Tools

GitHub tools require a GitHub integration configured with a personal access token. Default repo is set in the integration config.

### `list_prs`

List open pull requests for a repository.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | No | Repository in `owner/repo` format (uses default if omitted) |

**Returns:** Numbered list of open PRs with title, author, draft status, and review decision.

---

### `get_pr_status`

Get CI status, review state, and check runs for a specific PR.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pr_number` | number | Yes | Pull request number |
| `repo` | string | No | Repository in `owner/repo` format |

**Returns:** PR title, state, approval count, and per-check-run status.

---

### `create_github_issue`

Create a new issue in a repository.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Issue title |
| `body` | string | Yes | Issue body |
| `repo` | string | No | Repository in `owner/repo` format |

**Returns:** URL of the created issue.

---

## Gmail / Email Tool

### `send_email`

Send an email via Gmail on the user's behalf. Requires Gmail OAuth configured.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject line |
| `body` | string | Yes | Plain-text email body |
| `reply_to_message_id` | string | No | Gmail message ID to thread the reply onto |

**Returns:** `"Email sent to <address>"`

---

## Google Calendar Tools

These tools require Google Calendar OAuth configured.

### `create_calendar_event`

Create a new event on the user's primary Google Calendar.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `summary` | string | Yes | Event title |
| `start` | string | Yes | ISO 8601 start datetime or date (for all-day) |
| `end` | string | Yes | ISO 8601 end datetime or date |
| `description` | string | No | Event description |
| `location` | string | No | Event location |
| `all_day` | boolean | No | Set to `true` for all-day events |

**Returns:** `"Created calendar event \"<title>\" (id: <id>)"`

---

### `update_calendar_event`

Update an existing Google Calendar event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_id` | string | Yes | Google Calendar event ID |
| `summary` | string | No | New title |
| `start` | string | No | New start datetime |
| `end` | string | No | New end datetime |
| `description` | string | No | New description |
| `location` | string | No | New location |

---

### `delete_calendar_event`

Delete a Google Calendar event by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_id` | string | Yes | Google Calendar event ID |

---

## Custom Skills and Plugin Tools

Custom skills and plugin tools appear in the registry alongside built-in tools once loaded. They follow the same `Tool` interface and are indistinguishable from built-in tools from the agent's perspective.

**Bash tools** accept an `input` parameter: a key-value map whose values are substituted into the command template as `{{input.key}}`.

**HTTP tools** accept a `body` parameter for non-GET requests (sent as JSON).

**MCP tools** are listed but not yet proxied — configure the MCP server via `koa mcp` directly.

See `docs/PLUGINS.md` for how to write plugins and custom skills.
