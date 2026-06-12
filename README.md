# Koa

Koa is a self-hosted personal AI assistant built on Claude. It provides a terminal TUI, a browser-based web console, and an MCP server so Claude Desktop can call Koa's tools directly. All three frontends share the same agent loop, tool registry, and three-layer memory system — meaning the same context, memory, and history follow you across every interface.

---

## Features

- **Ink TUI** — terminal chat with spinner, Engram memory sidebar, and live cost display
- **Web console** — React/Vite UI with SSE streaming, collapsible tool calls, and token usage sidebar
- **MCP server mode** — expose Koa's tools to Claude Desktop over stdio (JSON-RPC 2.0)
- **Three-layer memory** — project markdown + SpiderBrain structural graph + Engram archive, all injected into every system prompt
- **Smart model routing** — auto-selects Haiku / Sonnet / Opus by message complexity; per-turn `@tier:` override
- **Prompt caching** — `cache_control: ephemeral` on system prompt and tool list; reduces repeat-context spend ~80%
- **Sandboxed file tools** — `read_file`, `write_file`, `edit_file`, `grep` restricted to configured project root
- **Sandboxed code execution** — JavaScript, Python, and Bash via local process or Docker container
- **Browser automation** — Playwright-backed tools for navigating, extracting, and screenshotting pages
- **Web search + fetch** — Brave Search API + Jina Reader for reading live pages
- **GitHub tools** — list PRs, get CI status, create issues; supports multiple instances (per-instance token + default repo, resolved by repo owner)
- **Gmail + Google Calendar** — read email, send email, create/update/delete calendar events
- **Channels** — Telegram bot, Slack slash commands, Twilio SMS inbound
- **Push notifications** — Web Push (VAPID) and APNs for iOS
- **Plugin system** — drop a JSON file in `~/.koa/plugins/` to add custom bash or HTTP tools
- **Custom skills** — create ad-hoc bash/HTTP tools via the web console without writing code
- **Agent dispatch** — spawn specialist sub-agents (architect, reviewer, debug, security-reviewer)
- **Conversation history** — SQLite-backed conversation log with full-text search and Markdown export
- **Projects + tasks** — lightweight project/task tracker with priority, dependencies, and deadlines
- **Token usage dashboard** — per-session cost, cache hit rate, and per-category token counts

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18 or later | Required |
| npm | ships with Node | Required |
| Python 3 | any modern version | Required for Engram memory (optional feature) |
| `ANTHROPIC_API_KEY` | — | [console.anthropic.com](https://console.anthropic.com) |
| Playwright | optional | Browser automation tools |
| Docker | optional | Docker sandbox backend for `execute_code` |
| Brave Search API key | optional | `web_search` tool |
| OpenAI API key | optional | Whisper voice transcription |

---

## Quick Start

```bash
# 1. Clone and install
git clone git@github.com:<your-username>/koa.git
cd koa
./install.sh

# 2. Start the TUI (default command)
koa

# 3. Or start the web console
koa web
# Opens http://localhost:3000 automatically
```

The install script handles dependency installation, TypeScript compilation, Vite build, and global CLI linking. If `ANTHROPIC_API_KEY` is not already in your environment, it will prompt you.

---

## Installation Flags

```bash
./install.sh [--no-global] [--no-build]
```

| Flag | Effect |
|------|--------|
| `--no-global` | Skip `npm link` — run via `npm start` instead |
| `--no-build` | Skip TypeScript and Vite build steps |
| `--help` | Print usage |

---

## All CLI Commands

| Command | Flags | Description |
|---------|-------|-------------|
| `koa` / `koa chat` | | Interactive TUI chat session (default command) |
| | `-p, --project <path>` | Override project root (defaults to cwd) |
| | `-m, --model <model>` | Claude model ID to use this session |
| | `--no-engram` | Disable Engram memory integration |
| | `--no-cache` | Disable Anthropic prompt caching |
| `koa web` | | Start the browser-based web console |
| | `-p, --port <port>` | Port to listen on (default: 3000) |
| | `--no-open` | Do not open browser automatically |
| | `--project <path>` | Override project root |
| | `-m, --model <model>` | Claude model ID for this session |
| `koa query <terms>` | | Query Engram memory and print results to stdout |
| | `-p, --project <path>` | Override project root |
| `koa mcp` | | Start Koa as an MCP tool server on stdio |
| | `-p, --project <path>` | Override project root |
| | `--no-engram` | Disable Engram memory integration |
| `koa setup` | | Interactive first-run setup wizard |
| | `--reset` | Re-prompt for all values even if already set |
| | `--headless` | Validate T1 credentials only; exit 1 if missing (for Docker/CI) |
| `koa doctor` | | Diagnose and optionally fix stale `~/.koa/config.json` entries |
| | `--fix` | Back up config and rewrite to canonical format |
| `koa config set <key> [value]` | | Persist a configuration value (omit value for `web-token` to auto-generate) |
| `koa config unset <key>` | | Remove a persisted configuration value |
| `koa config show` | | Show current configuration (credentials are masked) |
| `koa update` | | Update Koa: git pull + rebuild, with automatic rollback of `dist/` if the build or tests fail |
| | `--check` | Report whether an update is available without applying it |
| | `--no-test` | Skip the vitest verification step after building |
| | `--force` | Proceed even if guards (e.g. dirty worktree) would normally block |

---

## Environment Variables

Copy `.env.example` to `.env` (local dev) or `/etc/koa/env` (server). The install script creates `.env` for you.

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key |
| `KOA_WEB_TOKEN` | — | Bearer token for web console auth (optional for local use) |
| `KOA_HOME` | `~/.koa` | Root directory for DB, credentials, memories, logs |
| `KOA_MODEL` | `claude-haiku-4-5-20251001` | Default Claude model ID |
| `KOA_MAX_TOKENS` | model max | Max output tokens per turn |
| `KOA_PROVIDER` | `anthropic` | LLM provider: `anthropic` or `ollama` |
| `KOA_OLLAMA_MODEL` | `llama3.2` | Ollama model tag (when `provider=ollama`) |
| `KOA_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `KOA_SMART_ROUTING` | `false` | Auto-route to Haiku/Sonnet/Opus by complexity |
| `KOA_ENGRAM` | `true` | Enable Engram session memory |
| `KOA_COMPACT_TURNS` | `20` | Compact context after N turns |
| `KOA_CHECKPOINT_TURNS` | — | Auto-checkpoint every N turns |
| `KOA_CHECKPOINT_MINUTES` | — | Auto-checkpoint every N minutes |
| `KOA_MAX_TOOL_OUTPUT` | `20000` | Max characters captured from a single tool call |
| `KOA_NO_CACHE` | `false` | Disable Anthropic prompt caching |
| `KOA_SANDBOX_BACKEND` | `local` | Code execution backend: `local` or `docker` |
| `KOA_SANDBOX_TIMEOUT_MS` | `10000` | Code execution timeout in milliseconds |
| `KOA_TTS_PROVIDER` | `say` | TTS provider: `say` (macOS) or `elevenlabs` |
| `ELEVENLABS_API_KEY` | — | ElevenLabs API key |
| `BRAVE_API_KEY` | — | Brave Search API key (enables `web_search` tool) |
| `OPENAI_API_KEY` | — | OpenAI key for Whisper transcription |

See `.env.example` for the full list including Google OAuth, Telegram, Slack, Twilio, and APNs variables.

---

## Claude Desktop (MCP)

Koa exposes its core tools — `bash`, `read_file`, `write_file`, `edit_file`, `grep`, `engram_query` — directly to Claude Desktop as MCP primitives. The agent loop is not exposed; Claude Desktop calls the tools itself.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

The `--project` flag sets the sandbox root. All file operations are restricted to that directory.

---

## Layered Memory

Koa uses a three-layer memory system injected as XML blocks into every system prompt.

**Layer 1 — Project Markdown** (`~/.koa/projects/<slug>-<hash>/`)

Per-project markdown files: `PROJECT.md` (architecture overview), `STATE.md` (current work state), `BACKLOG.md` (tasks), `HANDOFF.md` (agent dispatch context), and dated journal entries. Written atomically (tmp → rename).

Type `/checkpoint` in the TUI to save `STATE.md` and a journal entry immediately, or `POST /api/checkpoint` from the web console.

**Layer 2 — SpiderBrain** — static dependency graph (`synganglion.json`). Injected as a `<spiderbrain_context>` block. Auto-rebuilt if missing or older than 7 days.

**Layer 3 — Engram** — SQLite-backed project memory. Indexed at `~/.engram/brains/<slug>/brain.db`. All Engram calls silently no-op if the brain doesn't exist.

```bash
# Index a project for Engram
python3 ~/.claude/skills/engram/cli/engram.py index /path/to/project

# Query memory from CLI
koa query "authentication decisions"
```

---

## Development

```bash
# Type-check without emitting
npm run typecheck

# Full test suite (Vitest)
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Lint
npm run lint
npm run lint:fix

# Format
npm run format

# Build TypeScript
npm run build

# Build web console
npm run build:web

# Run backend in dev mode (tsx watch — no build needed)
npm run dev

# Run Vite dev server (separate terminal)
cd web && npm run dev
```

The Vite dev server (port 5173) proxies `/api` to Express (port 3000). Open `http://localhost:5173` for the web console during development.

---

## Further Reading

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Agent loop, tool system, SSE protocol, security model |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, branch strategy, how to add tools/plugins/skills |
| [docs/API.md](docs/API.md) | Full REST API reference with curl examples |
| [docs/TOOLS.md](docs/TOOLS.md) | All agent tools: parameters, security notes, examples |
| [docs/PLUGINS.md](docs/PLUGINS.md) | Plugin system: manifest format, transports, examples |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, systemd, Caddy, Tailscale, env vars |
| [RUNBOOK.md](RUNBOOK.md) | Day-to-day ops: backup, restore, health checks, log rotation |

---

## License / Author

Personal project. Not published to npm. Set `KOA_USER_NAME` in your environment to personalise the assistant.
