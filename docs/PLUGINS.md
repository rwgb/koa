# Koa Plugin System

Plugins let you add custom tools to the agent without writing TypeScript or rebuilding the project. A plugin is a single JSON file that declares one or more tools with a name, description, input schema, transport type, and transport-specific configuration.

---

## How Plugins Work

1. Drop a JSON file in `~/.koa/plugins/`
2. Restart the Koa server
3. The plugin's tools appear in the agent's tool registry alongside built-in tools

Plugins are loaded by `src/plugins/loader.ts` at server startup. Invalid or unparseable plugin files are skipped with a warning — they do not crash the server.

Plugin files are stored at `~/.koa/plugins/` by default. If `KOA_HOME` is set, the directory becomes `$KOA_HOME/plugins`.

---

## Manifest Format

```json
{
  "name": "my_plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "tools": [
    {
      "name": "tool_name",
      "description": "Tool description shown to the agent",
      "inputSchema": { ... },
      "transport": "bash | http | mcp",
      "config": { ... }
    }
  ]
}
```

### Top-level fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Plugin identifier |
| `version` | string | No | Defaults to `"0.0.0"` |
| `description` | string | No | Human-readable description |
| `tools` | array | Yes | One or more tool definitions |

### Tool fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Must match `^[a-z][a-z0-9_]{1,49}$` — used as the tool name the agent calls |
| `description` | string | Yes | Shown to the agent; write this as you would a function docstring |
| `inputSchema` | object | No | JSON Schema for the tool's input. If omitted, the tool accepts no arguments |
| `transport` | string | Yes | `bash`, `http`, or `mcp` |
| `config` | object | Yes | Transport-specific key-value pairs (see below) |

---

## Transport: `bash`

Executes a shell command. Input values from the agent are substituted into the command template using `{{input.key}}` placeholders.

### Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | Shell command with optional `{{input.key}}` placeholders |

### Agent input

The agent passes an `input` object whose keys correspond to the placeholders in the command template. The `inputSchema` should declare an `input` property of type `object`:

```json
"inputSchema": {
  "type": "object",
  "properties": {
    "input": {
      "type": "object",
      "description": "Key-value pairs substituted into the command",
      "additionalProperties": { "type": "string" }
    }
  },
  "required": []
}
```

### Security notes

- Commands run as the Koa server process user
- Timeout is 30 s (hardcoded in the bridge)
- There is no output size cap in the bridge; keep commands focused

### Example: ping a homelab service

```json
{
  "name": "homelab",
  "version": "1.0.0",
  "description": "Check homelab service health",
  "tools": [
    {
      "name": "homelab_ping",
      "description": "Ping a homelab service by name and return its HTTP status.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "input": {
            "type": "object",
            "properties": {
              "service": {
                "type": "string",
                "description": "Service hostname or IP"
              }
            }
          }
        }
      },
      "transport": "bash",
      "config": {
        "command": "curl -sf --max-time 5 http://{{input.service}}/health && echo OK || echo FAIL"
      }
    }
  ]
}
```

---

## Transport: `http`

Makes an HTTP request to a configured URL. The agent can optionally provide a request body.

### Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Full URL to call |
| `method` | No | HTTP method (default: `GET`) |

### Agent input

The agent can pass a `body` parameter (string) for non-GET requests. Declare it in `inputSchema`:

```json
"inputSchema": {
  "type": "object",
  "properties": {
    "body": {
      "type": "string",
      "description": "JSON body to send with the request"
    }
  },
  "required": []
}
```

The bridge sends the body with `Content-Type: application/json`. The full HTTP response (status + body) is returned to the agent.

### Security notes

- No SSRF guard is applied to plugin HTTP tools — you are responsible for ensuring the configured URL is safe
- No authentication headers are added automatically; embed tokens in the URL or add them to `command` templates for bash tools

### Example: trigger a webhook

```json
{
  "name": "notifications",
  "version": "1.0.0",
  "description": "Send ntfy notifications",
  "tools": [
    {
      "name": "ntfy_alert",
      "description": "Publish a message to an ntfy topic.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "body": {
            "type": "string",
            "description": "The notification message (plain text)"
          }
        },
        "required": ["body"]
      },
      "transport": "http",
      "config": {
        "url": "https://ntfy.sh/my-topic",
        "method": "POST"
      }
    }
  ]
}
```

---

## Transport: `mcp`

MCP proxy tools are listed in the registry but are not yet executable. The tool returns a message directing the user to configure the MCP server via `koa mcp` directly. This transport type is reserved for a future implementation.

---

## Custom Skills vs Plugins

Custom skills and plugins use the same `bash`/`http` bridge internally. The differences are:

| | Plugins | Custom Skills |
|-|---------|---------------|
| Storage | `~/.koa/plugins/<name>.json` | `~/.koa/custom-skills.json` |
| Format | Full plugin manifest (name, version, multiple tools) | Per-skill entries |
| Created via | File drop | Web console Settings → Skills, or `POST /api/admin/skills/custom` |
| Multiple tools | Yes | One tool per entry |

Both appear as `source: plugin` or `source: custom` in the skills list (`GET /api/admin/skills`).

---

## Tool Bridge API

The bridge (`src/plugins/bridge.ts`) converts a plugin tool manifest into a `Tool` object that the registry can use. It handles:

- Template substitution for bash tools (`{{input.key}}`)
- HTTP method, URL, and body forwarding for HTTP tools
- Fallback error message for MCP tools

If you are building a more complex plugin that needs async logic, type validation, or sandboxing, write a TypeScript tool directly in `src/agent/tools/` instead. See `CONTRIBUTING.md` for the process.

---

## Viewing Loaded Plugins

```bash
curl http://localhost:3000/api/admin/plugins \
  -H "Authorization: Bearer $KOA_WEB_TOKEN"
```

The response lists all loaded plugins with tool names and the source file path. The web console also shows this in Settings → Skills.
