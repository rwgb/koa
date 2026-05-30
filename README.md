# Koa

A self-built personal AI assistant with CLI, web console, and MCP server.

---

## Vision

Koa is not just a developer tool — it is a personal AI assistant built from scratch. The long-term goal is full integration across the interfaces that matter: a browser-accessible web UI, iMessage, Gmail, Google Calendar, and autonomous web browsing. Every architectural decision is made with that trajectory in mind. Today's CLI is the foundation.

---

## Features

- **Ink TUI** — terminal chat interface with a spinner, Engram sidebar, and live token cost display
- **Web console** — React/Vite browser UI with SSE streaming, collapsible tool calls, and a token usage sidebar
- **MCP server mode** — expose Koa's tools directly to Claude Desktop over stdio (JSON-RPC 2.0)
- **Engram memory** — persistent project memory injected into every system prompt; survives across sessions
- **Smart model routing** — auto-selects Haiku / Sonnet / Opus by message complexity; per-turn `@tier:` override
- **Token usage dashboard** — tracks input, output, cache-write, cache-read tokens; shows estimated cost and cache hit rate
- **Prompt caching** — `cache_control: ephemeral` on system prompt and tool list; reduces repeat-context spend by ~80%
- **File sandbox** — all file tools are restricted to the configured project root; no path traversal possible
- **Conversation compaction** — sliding window keeps context from growing unboundedly across long sessions

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or later |
| npm | ships with Node |
| Python 3 | required for Engram memory features |
| `ANTHROPIC_API_KEY` | get one at [console.anthropic.com](https://console.anthropic.com) |

Engram is optional. If the CLI is absent or no brain has been indexed for the project, Koa runs without memory features and all Engram calls silently no-op.

---

## Install

```bash
./install.sh
```

The script does the following in order:

1. Checks for Node.js ≥ 18, npm, and (optionally) the Engram CLI
2. Creates a `.env` file and prompts for your `ANTHROPIC_API_KEY` if not already set
3. Runs `npm install` for the root package and the `web/` package
4. Compiles TypeScript (`tsc`) to `dist/`
5. Builds the Vite web console to `web/dist/`
6. Runs `npm link` to make the `koa` command available globally

**Flags:**

| Flag | Effect |
|------|--------|
| `--no-global` | Skip `npm link`; run via `npm start` instead |
| `--no-build` | Skip TypeScript and Vite build steps |
| `--help` | Print usage |

---

## Quick Start

```bash
# Interactive TUI chat (default command)
koa chat

# Browser-based web console on port 3000
koa web

# Search Engram memory from the command line
koa query "authentication decisions"

# Expose tools to Claude Desktop via stdio MCP
koa mcp
```

---

## All CLI Commands

| Command | Flags | Description |
|---------|-------|-------------|
| `koa chat` | `-p, --project <path>` | Override project root (defaults to `cwd`) |
| *(default)* | `-m, --model <model>` | Claude model ID to use this session |
| | `--no-engram` | Disable Engram memory integration |
| `koa query <terms>` | `-p, --project <path>` | Override project root |
| | | Query Engram memory and print results to stdout |
| `koa web` | `-p, --port <port>` | Port to listen on (default: `3000`) |
| | `--no-open` | Do not open browser automatically |
| | `--project <path>` | Override project root |
| | `-m, --model <model>` | Claude model ID to use this session |
| `koa mcp` | `-p, --project <path>` | Override project root |
| | `--no-engram` | Disable Engram memory integration |
| | | Start Koa as an MCP tool server on stdio |

`chat` is the default command — running `koa` with no subcommand is equivalent to `koa chat`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key; get one at console.anthropic.com |
| `KOA_MODEL` | `claude-sonnet-4-6` | Default Claude model ID used for all turns |
| `KOA_SMART_ROUTING` | `false` | Set to `true` to enable automatic Haiku/Sonnet/Opus routing by message complexity |
| `KOA_MAX_TOOL_OUTPUT` | `12000` | Maximum characters per tool result; output beyond this limit is truncated with a sentinel |
| `KOA_COMPACT_TURNS` | `10` | Number of turns to keep in the sliding conversation window before older messages are dropped |
| `KOA_ENGRAM` | `true` | Set to `false` to disable Engram memory integration globally |

All variables can be placed in a `.env` file at the project root. The install script creates this file.

---

## Claude Desktop (MCP)

Koa can expose its tools — `bash`, `read_file`, `write_file`, `edit_file`, `grep`, and `engram_query` — directly to Claude Desktop as MCP tools. The agent loop itself is deliberately not exposed; Claude Desktop calls the primitives directly.

Add the following to your Claude Desktop configuration file (typically `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "koa": {
      "command": "koa",
      "args": ["mcp", "--project", "/absolute/path/to/your/project"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Replace `/absolute/path/to/your/project` with the real path. The `--project` flag determines the sandbox root — all file operations are restricted to that directory.

> **Note on stdout discipline**: the `mcp` command uses stdio for JSON-RPC transport. All diagnostic output is written to stderr. Never add `console.log` calls in the MCP code path.

---

## Engram Memory

[Engram](https://github.com/koalalorenzo/engram) is a SQLite-backed project memory engine. When a brain exists for the current project, Koa injects a `<engram_context>` block into the system prompt before every turn containing:

- **Session Goal** — the stated goal for the current session
- **Hot Files** — up to 10 files most relevant to recent work, ranked by activity score
- **Key Files** — master files that are always relevant (architecture docs, config, etc.)
- **Previous Session** — a brief summary of the last session's work

To index a project for the first time:

```bash
python3 ~/.claude/skills/engram/cli/engram.py index /path/to/project
```

To query memory from the CLI without starting a full chat session:

```bash
koa query "authentication decisions"
koa query "why did we choose SSE over WebSockets"
```

Engram brains live at `~/.engram/brains/<slug>/brain.db`. If no brain exists, all Engram calls silently no-op — the agent runs normally without memory context.

---

## Token Dashboard

Both the TUI and the web console display live token usage throughout the session.

**TUI StatusBar** (bottom border) shows:
- `$0.0023` — estimated session cost in USD
- `82% cache` — cache hit rate for the session

**Web console Sidebar** shows per-category token counts (input, output, cache write, cache read), cache hit percentage, and total estimated cost.

**Web console StatusBar** shows:
- The configured model name
- A color-coded tier badge (`haiku` = green, `sonnet` = blue, `opus` = purple)
- Turn count
- Estimated cost pill

Pricing is keyed by model prefix (`claude-haiku`, `claude-sonnet`, `claude-opus`) so future model versions inherit the correct rates automatically.

---

## Development

```bash
# Type-check without emitting
npm run typecheck

# Run the full test suite (Vitest)
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint
npm run lint:fix

# Format
npm run format

# Build TypeScript
npm run build

# Build the web console
npm run build:web

# Run the CLI in development mode (tsx watch — no build needed)
npm run dev

# Run the web console Vite dev server (in a separate terminal)
cd web && npm run dev
```

During development, run `npm run dev` (Express + AgentLoop on port 3000) and `cd web && npm run dev` (Vite dev server on port 5173) in separate terminals. The Vite proxy forwards `/api` requests to port 3000.

---

## Project Structure

```
koa/
├── install.sh                  # One-command setup script
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── docs/
│   └── claude_desktop_config_example.json
├── src/
│   ├── cli/
│   │   └── index.ts            # Commander entrypoint (chat, query, web, mcp)
│   ├── config/
│   │   └── index.ts            # loadConfig(), env var parsing, Engram path helpers
│   ├── types/
│   │   └── index.ts            # Core domain types (KoaConfig, AgentState, Tool, etc.)
│   ├── agent/
│   │   ├── loop.ts             # AgentLoop: initialize / turn / finalize
│   │   ├── router.ts           # Smart model routing: classifyMessage, selectModel
│   │   ├── usage.ts            # UsageTracker, PRICING, cost computation
│   │   └── tools/
│   │       ├── registry.ts     # ToolRegistry
│   │       ├── bash.ts         # bash tool
│   │       ├── files.ts        # read_file, write_file, edit_file, grep (sandboxed)
│   │       └── engram_tool.ts  # engram_query tool
│   ├── engram/
│   │   └── client.ts           # EngramClient: sync, getContext, query, buildSystemPromptInjection
│   ├── server/
│   │   ├── index.ts            # Express server: GET /api/context, POST /api/chat (SSE)
│   │   ├── events.ts           # SseEvent discriminated union
│   │   └── mcp.ts              # MCP server: toMcpInputSchema, createMcpServer, startMcpServer
│   ├── tui/
│   │   ├── App.tsx             # Ink TUI root
│   │   └── components/
│   │       ├── ChatMessage.tsx
│   │       ├── Sidebar.tsx
│   │       └── StatusBar.tsx
│   └── __tests__/
│       ├── config.test.ts
│       ├── engram_injection.test.ts
│       ├── files_tool.test.ts
│       ├── mcp.test.ts
│       ├── registry.test.ts
│       ├── router.test.ts
│       └── usage.test.ts
└── web/                        # Vite + React 18 web console
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # Top-level state, SSE routing
        ├── api.ts              # fetchStatus(), streamChat()
        ├── types.ts            # SseEvent, ChatItem, AgentStatus (web-side types)
        ├── index.css           # Dark terminal theme, all component styles
        └── components/
            ├── StatusBar.tsx
            ├── Sidebar.tsx
            ├── ChatPanel.tsx
            └── MessageBubble.tsx
```

---

## License / Author

Personal project by Ralph Brynard. Not published to npm. Private repository.
