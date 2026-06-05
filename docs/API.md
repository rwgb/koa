# Koa API Reference

All endpoints are served by the Express server started by `koa web`. Default base URL: `http://localhost:3000`.

## Authentication

If `KOA_WEB_TOKEN` is set, every `/api/` request (except the OAuth callback endpoints and webhook endpoints that have their own channel-specific auth) must include:

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401 Unauthorized`. Authentication is skipped entirely if `KOA_WEB_TOKEN` is not configured, which is fine for local personal use.

The auth rate-limiter allows 10 requests per 15-minute window per IP. Exceeded requests receive `429 Too Many Requests`.

---

## Chat Endpoints

### `GET /api/context`

Returns the current agent state. Call this on initial connect to hydrate the web console before the first turn.

**Auth required:** Yes

**Response:**

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
  "activeTier": "haiku | sonnet | opus",
  "activeAgent": "string",
  "usage": {
    "inputTokens": "number",
    "outputTokens": "number",
    "cacheWriteTokens": "number",
    "cacheReadTokens": "number",
    "estimatedCostUsd": "number",
    "cacheHitRate": "number",
    "turnsCount": "number"
  },
  "spiderBrain": "object | null"
}
```

```bash
curl http://localhost:3000/api/context \
  -H "Authorization: Bearer $KOA_WEB_TOKEN"
```

---

### `POST /api/chat`

Send a message to the agent. Returns a Server-Sent Events stream.

**Auth required:** Yes

**Request body:**

```json
{ "message": "string" }
```

**Response:** `Content-Type: text/event-stream`

Each event is a line beginning with `data: ` followed by a JSON object. Events are separated by `\n\n`.

| Event type | Fields | When emitted |
|------------|--------|--------------|
| `classifying` | — | Smart routing is classifying the message |
| `classified` | `tier: string` | Classification result |
| `tool_call` | `name: string`, `input: object` | Before each tool executes |
| `tool_result` | `name: string`, `result: string` | After each tool returns |
| `content` | `text: string` | Text delta from the assistant |
| `chain_start` | `agent: string` | Auto-chaining dispatched to a sub-agent |
| `usage` | `turn: TurnUsage`, `session: SessionUsageStats`, `contextStats: object` | After content, before done |
| `done` | `turnCount: number`, `model: string`, `tier: string`, `agent: string` | All events for this turn are complete |
| `error` | `message: string` | Agent error (sanitised — no paths or stack traces) |

**Error responses:**
- `400 Bad Request` — message is missing or empty
- `429 Too Many Requests` — agent is busy with another turn

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer $KOA_WEB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What files are in the project root?"}' \
  | while read -r line; do echo "$line"; done
```

---

### `GET /api/sse/chat`

SSE-over-GET variant for iOS/native clients. Identical event stream to `POST /api/chat` but the message is passed as a query parameter. Use `?format=brief` to strip ANSI codes and cap tool results at 500 characters (suitable for mobile data).

**Auth required:** Yes

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `message` | Yes | The message to send |
| `format` | No | Set to `brief` for compact output |

```bash
curl -N "http://localhost:3000/api/sse/chat?message=hello&format=brief" \
  -H "Authorization: Bearer $KOA_WEB_TOKEN"
```

---

### `POST /api/checkpoint`

Trigger an immediate STATE.md and journal update without ending the session. Returns `409` if an agent turn is in progress.

**Auth required:** Yes

**Response:**

```json
{ "status": "ok", "message": "Checkpoint saved." }
```

**Error responses:**
- `409 Conflict` — agent turn in progress

```bash
curl -X POST http://localhost:3000/api/checkpoint \
  -H "Authorization: Bearer $KOA_WEB_TOKEN"
```

---

### `GET /api/voice/synthesize`

Synthesize text to speech. Returns an audio stream.

**Auth required:** Yes

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `text` | Yes | Text to synthesize (max 500 characters) |

**Response:** Audio stream (`audio/mpeg` or `audio/aiff` depending on provider)

**Error responses:**
- `400 Bad Request` — text missing or too long
- `503 Service Unavailable` — TTS not available

---

## Health and Status

### `GET /api/health`

Liveness check. Returns database status, channel connection status, server uptime, and version.

**Auth required:** No

**Response:**

```json
{
  "status": "ok",
  "db": "ok | error",
  "channels": {
    "gmail": "connected | not_configured",
    "sms": "connected | not_configured",
    "slack": "connected | not_configured"
  },
  "uptime": "number",
  "version": "string"
}
```

```bash
curl http://localhost:3000/api/health
```

---

### `GET /api/channels/status`

Returns which channels are configured.

**Auth required:** Yes

**Response:**

```json
{
  "gmail": "connected | not_configured",
  "sms": "connected | not_configured",
  "slack": "connected | not_configured"
}
```

---

## Projects and Tasks

### `GET /api/projects`

List all projects.

**Auth required:** Yes

**Response:** Array of project objects.

---

### `POST /api/projects`

Create a project.

**Auth required:** Yes

**Request body:**

```json
{
  "name": "string",
  "description": "string (optional)",
  "slug": "string (optional)"
}
```

**Response:** `201 Created` with `{ "project": {...} }`

**Error responses:**
- `400 Bad Request` — name missing

---

### `GET /api/projects/:id`

Get a single project.

**Error responses:**
- `404 Not Found`

---

### `PUT /api/projects/:id`

Update a project. Supported fields: `name`, `description`, `status` (`active | archived | done`).

---

### `DELETE /api/projects/:id`

Delete a project.

---

### `GET /api/tasks`

List tasks. Optional query params:

| Param | Description |
|-------|-------------|
| `projectId` | Filter by project |
| `status` | Filter by status (`todo | in_progress | blocked | done | cancelled`) |

---

### `GET /api/tasks/next`

Get the next actionable tasks (not blocked, ordered by priority).

**Query params:**

| Param | Description |
|-------|-------------|
| `projectId` | Optional project filter |
| `limit` | Number of tasks (1–100, default 5) |

---

### `POST /api/tasks`

Create a task.

**Request body:**

```json
{
  "projectId": "string",
  "title": "string",
  "description": "string (optional)",
  "priority": "number 1–5 (optional)",
  "deadline": "YYYY-MM-DD (optional)",
  "effortHours": "number (optional)",
  "tags": ["string"] 
}
```

**Response:** `201 Created` with `{ "task": {...} }`

---

### `GET /api/tasks/:id`

Get a single task.

---

### `PUT /api/tasks/:id`

Update a task. All fields from `POST /api/tasks` are accepted, plus `actual_hours`.

---

### `DELETE /api/tasks/:id`

Delete a task.

---

### `GET /api/tasks/:id/dependencies`

Get dependency relationships for a task.

---

### `POST /api/tasks/:id/dependencies`

Add a dependency.

**Request body:** `{ "dependsOnId": "string" }`

---

### `DELETE /api/tasks/:id/dependencies/:depId`

Remove a dependency.

---

### `GET /api/decisions`

List decisions. Optional `?projectId=` filter.

---

### `POST /api/decisions`

Record an architectural decision.

**Request body:**

```json
{
  "projectId": "string",
  "title": "string",
  "context": "string (optional)",
  "chosen": "string",
  "rationale": "string (optional)",
  "options": ["string"] 
}
```

---

### `GET /api/search`

Full-text search across tasks.

**Query params:** `q` (required, max 200 chars), `projectId` (optional)

---

### `GET /api/checkpoints`

List checkpoints. Optional `?projectId=` filter.

---

## Analytics

### `GET /api/analytics/streak`

Returns the current completion streak (consecutive days with at least one task completed) and total completion-day count.

---

### `GET /api/analytics/weekly-report`

Returns a weekly summary of task completions, time logged, and per-project breakdown.

---

### `GET /api/analytics/forecast`

Velocity-based completion forecast. Optional `?projectId=` filter.

---

### `GET /api/analytics/proactive`

Returns proactive alerts: overdue tasks, blocked tasks, upcoming deadlines.

---

## Conversations

### `GET /api/conversations`

List the 50 most recent conversations.

---

### `GET /api/conversations/search`

Full-text search across conversation turns.

**Query params:** `q` (required)

---

### `GET /api/conversations/:id`

Get a conversation record.

---

### `GET /api/conversations/:id/turns`

Get all turns for a conversation.

---

### `GET /api/conversations/:id/export`

Export a conversation. Supported formats: `json` (default), `markdown`.

**Query params:** `format=markdown`

---

### `DELETE /api/conversations`

Delete conversations older than a date.

**Query params:** `before=YYYY-MM-DD` (required)

---

## Calendar

All calendar endpoints require Google Calendar to be configured via OAuth (`GET /api/admin/oauth/calendar`).

### `GET /api/calendar/events`

List calendar events.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `start` | now | ISO 8601 start of range |
| `end` | +30 days | ISO 8601 end of range |

---

### `GET /api/calendar/conflicts`

Check if a task's deadline conflicts with calendar events.

**Query params:** `taskId` (required)

---

### `GET /api/calendar/availability`

Get available time blocks (no calendar events).

**Query params:** `start`, `end` (ISO 8601, default: now to +7 days)

---

### `POST /api/calendar/sync`

Trigger an immediate Google Calendar sync.

---

## Push Notifications

### `GET /api/push/vapid-key`

Get the VAPID public key for Web Push subscription setup.

**Response:** `{ "publicKey": "string" }`

---

### `POST /api/push/subscribe`

Register a Web Push subscription.

**Request body:**

```json
{
  "endpoint": "string",
  "keys": {
    "p256dh": "string",
    "auth": "string"
  }
}
```

**Error responses:**
- `400 Bad Request` — missing fields or invalid endpoint

---

### `DELETE /api/push/subscribe`

Remove the current Web Push subscription.

---

### `GET /api/push/apns-status`

Check APNs configuration status.

**Response:**

```json
{
  "configured": "boolean",
  "hasToken": "boolean",
  "sandbox": "boolean"
}
```

---

### `POST /api/push/apns-token`

Register an APNs device token (iOS).

**Request body:** `{ "token": "64-char hex string" }`

---

### `DELETE /api/push/apns-token`

Remove the registered APNs device token.

---

### `POST /api/push/reply`

Process a message from an iOS notification action and push the agent's response back via APNs. Returns `202 Accepted` immediately; agent response is delivered asynchronously.

**Request body:** `{ "message": "string" }`

---

## Webhooks

These endpoints have their own authentication and do not use the `KOA_WEB_TOKEN` bearer scheme.

### `POST /api/webhooks/slack`

Slack Events API and slash commands. Validates the `X-Slack-Signature` HMAC using the configured `signingSecret`. Responds to Slack's `url_verification` challenge without auth (required during app setup).

---

### `POST /api/webhooks/sms`

Twilio inbound SMS. Validates `X-Twilio-Signature` when an auth token is configured. Responds with empty TwiML `<Response/>`.

---

### `POST /api/voice/transcribe`

Transcribe audio using OpenAI Whisper. Requires `OPENAI_API_KEY`.

**Request:** Raw audio body (max 25 MB). Accepted `Content-Type`: `audio/wav`, `audio/m4a`, `audio/mpeg`, `audio/ogg`, `audio/webm`, `audio/mp4`.

**Response:** `{ "text": "string" }`

**Error responses:**
- `503 Service Unavailable` — `OPENAI_API_KEY` not configured
- `400 Bad Request` — no audio data
- `413 Payload Too Large` — audio exceeds 25 MB
- `502 Bad Gateway` — Whisper API error

---

## Admin

All admin endpoints require auth.

### `GET /api/admin/config`

Get the current runtime configuration.

**Response:** Object with all configurable settings (model, maxTokens, engramEnabled, smartRouting, etc.). Sensitive values like API keys are returned as booleans (`apiKeySet: true/false`).

---

### `PUT /api/admin/config`

Update runtime configuration. Changes take effect immediately and are persisted to `~/.koa/config.json`.

**Request body:** Partial config object. Accepted fields:

| Field | Type | Notes |
|-------|------|-------|
| `model` | string | Claude model ID |
| `maxTokens` | number | |
| `maxToolOutputChars` | number | |
| `engramEnabled` | boolean | |
| `smartRouting` | boolean | |
| `autoChaining` | boolean | |
| `compactAfterTurns` | number | |
| `autoCheckpointTurns` | number | |
| `autoCheckpointMinutes` | number | |
| `spiderBrainBrain` | string | Path to synganglion.json |
| `defaultProjectPath` | string | |
| `apiKey` | string | Written to credentials file |
| `braveApiKey` | string | Written to credentials file; empty string deletes |
| `briefingEnabled` | boolean | |
| `briefingTime` | string | `HH:MM` format |
| `ttsProvider` | string | `say` or `elevenlabs` |
| `elevenLabsVoiceId` | string | |
| `elevenLabsModel` | string | |
| `elevenLabsApiKey` | string | Written to credentials file |
| `provider` | string | `anthropic` or `ollama` |
| `ollamaModel` | string | |
| `ollamaBaseUrl` | string | Must be localhost or 127.0.0.1 |
| `sandboxBackend` | string | `local` or `docker` |
| `sandboxTimeoutMs` | number | 1000–300000 |

---

### `GET /api/admin/memory/engram`

Get the current Engram context and SpiderBrain context loaded by the agent loop.

---

### `GET /api/admin/memory/files`

Get the content of all project memory markdown files (PROJECT, STATE, BACKLOG, HANDOFF).

---

### `PUT /api/admin/memory/files/:file`

Update a project memory file. `:file` must be `PROJECT`, `STATE`, `BACKLOG`, or `HANDOFF`.

**Request body:** `{ "content": "string" }`

---

### `GET /api/admin/memory/facts`

Get all global user memories.

---

### `POST /api/admin/memory/facts`

Add a global memory.

**Request body:** `{ "fact": "string" }`

---

### `DELETE /api/admin/memory/facts`

Remove a memory. Matches by substring.

**Request body:** `{ "fact": "string" }`

---

### `POST /api/admin/brain/rebuild`

Trigger a SpiderBrain graph rebuild (runs molt.mjs).

---

### `GET /api/admin/activity/sessions`

Get journal entries from `~/.koa/projects/<slug>/journal/`, newest first.

---

### `GET /api/admin/integrations`

List all integrations with secrets masked (`***`).

---

### `PUT /api/admin/integrations/:id`

Create or update an integration.

**Request body:**

```json
{
  "type": "github | slack | ntfy | pushover | twilio | gmail | google-calendar | ...",
  "name": "string",
  "config": {
    "key": "value"
  }
}
```

---

### `DELETE /api/admin/integrations/:id`

Delete an integration.

**Error responses:**
- `404 Not Found`

---

### `POST /api/admin/integrations/:id/test`

Test an integration's connectivity. Implemented for: `ntfy`, `github`, `slack`, `pushover`.

**Response:** `{ "ok": "boolean", "message": "string" }`

---

### `GET /api/admin/notifications`

Get notification rules, quiet-hours settings, and escalation config.

---

### `PUT /api/admin/notifications/rules`

Replace notification rules.

**Request body:** `{ "rules": [...] }`

---

### `PUT /api/admin/notifications/quiet-hours`

**Request body:** `{ "enabled": boolean, "from": "HH:MM", "to": "HH:MM" }`

---

### `POST /api/admin/notifications/test`

Send a test notification to a configured channel.

**Request body:** `{ "channel": "string" }` — integration id or type

---

### `PUT /api/admin/notifications/escalation`

**Request body:** `{ "enabled": boolean }`

---

### `GET /api/admin/skills`

List installed skills (built-in + custom + plugin) and the marketplace catalogue of not-yet-installed skills.

---

### `POST /api/admin/skills/custom`

Create a custom skill.

**Request body:**

```json
{
  "name": "string (^[a-z][a-z0-9_]{1,49}$)",
  "description": "string",
  "type": "bash | http | mcp",
  "config": { "key": "value" }
}
```

---

### `DELETE /api/admin/skills/custom/:name`

Delete a custom skill.

---

### `GET /api/admin/plugins`

List loaded plugins with name, version, description, and tool names.

---

### `GET /api/admin/sandbox/status`

Check code execution sandbox availability.

**Response:** `{ "available": boolean, "backend": "local | docker" }`

---

### `GET /api/admin/browser/status`

Check Playwright / browser automation availability.

**Response:** `{ "available": boolean, "playwrightInstalled": boolean }`

---

### `POST /api/admin/browser/install`

Install Playwright Chromium. Streams install output as `text/plain`. No-ops if already installed.

---

### `GET /api/admin/ollama/models`

List models available from the configured Ollama server.

**Response:** `{ "models": ["string"] }`

**Error responses:**
- `400 Bad Request` — ollamaBaseUrl is not a local URL
- `502 Bad Gateway` — cannot reach Ollama

---

### `GET /api/admin/telegram`

Get Telegram integration status.

**Response:** `{ "configured": boolean, "hasDefaultChatId": boolean, "polling": boolean }`

---

### `POST /api/admin/telegram`

Configure the Telegram bot token and default chat ID. Send an empty string to unconfigure.

**Request body:** `{ "botToken": "string", "defaultChatId": "string" }`

---

## OAuth Flows

### `GET /api/admin/oauth/gmail`

Start Gmail OAuth. Returns `{ "url": "string" }` — redirect the user to this URL.

### `GET /api/admin/oauth/gmail/callback`

Gmail OAuth callback (called by Google). Redirects to `/integrations` on completion.

### `GET /api/admin/oauth/calendar`

Start Google Calendar OAuth. Returns `{ "url": "string" }`.

### `GET /api/admin/oauth/calendar/callback`

Calendar OAuth callback. Redirects to `/integrations` on completion.

---

## MCP Tools (koa mcp)

When running `koa mcp`, Koa starts a JSON-RPC 2.0 server over stdio. Claude Desktop calls these tools directly — there is no agent loop involved.

The tools exposed match those registered in the tool registry. By default: `bash`, `read_file`, `write_file`, `edit_file`, `grep`, `analyze_image`, `engram_query`, `remember`, `forget`, `spiderbrain_query`, `spiderbrain_cascade`, `spiderbrain_molt`. See `docs/TOOLS.md` for tool parameter documentation.

All file tools are sandboxed to the `--project` path specified on the command line.
