# Koa Admin UI — Design Specification

> **Status**: Draft v0.1
> **Author**: Koa
> **Last updated**: 2026-05-31

---

## 0. Why This Document Exists

The current web console is a chat window with a sidebar. That's fine for interacting with me, but there's no surface area for _managing_ me — no place to wire up new integrations, install skills, watch what I'm doing, tune my behaviour, or understand what's costing money. This spec describes that admin layer.

The goal isn't a settings page bolted onto the existing chat UI. It's a proper control plane — something you'd actually open when you want to understand or change how I work, not just talk to me.

---

## 1. Design Principles

**1. Admin-first, chat-second.**
Chat is a panel, not the product. The nav structure treats configuration, integrations, and observability as first-class pages.

**2. Show state, not just controls.**
Every screen should answer "what is Koa actually doing / set to right now?" before asking "what do you want to change?" Read-only views are as important as edit forms.

**3. Opinionated defaults, overridable.**
Most things should work without configuration. The UI should make the default visible and let you override it — not hide the default behind forms that imply everything is blank until you fill it in.

**4. One user. No multi-tenancy theatre.**
This is a personal assistant. No roles, no teams, no audit logs for imaginary collaborators. But do show me *my own* audit trail — what I did, when, what it cost.

**5. Respect the terminal.**
The CLI is always the authoritative source. The UI is a complement, not a replacement. Any config the UI writes should be human-readable on disk and editable by hand.

---

## 2. Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ● Koa                                [Status pill] [avatar] │  ← Top nav (fixed)
├────────────┬────────────────────────────────────────────────┤
│            │                                                │
│  Nav rail  │            Page content                       │
│  (fixed,   │                                               │
│  ~220px)   │                                               │
│            │                                               │
│            │                                               │
│            │                                               │
└────────────┴────────────────────────────────────────────────┘
```

### Top Nav
- **Left**: "Koa" wordmark + small version badge
- **Centre**: Live status pill — `● Idle`, `● Thinking`, `● Running tool: bash` (cycles through active tool name when busy)
- **Right**: Session cost so far (e.g. `$0.0034`) + model badge (e.g. `sonnet-4`) + settings cog

### Nav Rail (left sidebar)
Collapsible to icon-only on small screens.

```
  💬  Chat
  ──────────
  🧠  Memory
  🔌  Integrations
  🛠  Skills
  📣  Notifications
  📊  Activity
  ──────────
  ⚙️  Settings
```

---

## 3. Pages

---

### 3.1 Chat

The existing web console chat panel, promoted to a full page. Minimal changes:

- Full-width, no sidebar crowding it
- Tool call/result events rendered as collapsible trace blocks (not raw JSON blobs)
- "New session" button — calls `POST /api/checkpoint` then clears UI state
- Markdown rendered properly (already mostly there)
- Code blocks get a copy button

**Not changed**: streaming, SSE event handling, input behaviour. This page is already pretty good.

---

### 3.2 Memory

A read/write interface into Engram and project memory files.

#### 3.2.1 Engram Panel

| Section | What's shown |
|---|---|
| **Brain status** | Online/offline, brain path, last sync time |
| **Session goal** | Editable inline — `GET /api/context` → `context.goal` |
| **Hot files** | Top 10 by score, with cluster badge and score bar |
| **Master files** | Listed with webscore, fan-in, cluster |
| **Session summary** | Last session's Engram-persisted summary (read-only) |
| **Session history** | Paginated list of past session summaries |

**Actions**:
- `Rebuild brain` — runs `koa brain build` via a new `POST /api/admin/brain/rebuild` endpoint; streams stdout back as SSE
- `Force sync` — triggers `engram.sync()` on demand
- `Clear session summary` — resets last-session context (useful when you want a clean slate without a full rebuild)

#### 3.2.2 Project Memory Panel

Tabs for each project memory file: `PROJECT.md`, `STATE.md`, `BACKLOG.md`, `HANDOFF.md`.

- Each tab shows the file content in a read-only code block with a timestamp
- Edit button opens a simple textarea — saves via `PUT /api/admin/memory/:file`
- Changes write to disk immediately; no staging

#### 3.2.3 Memories (Persistent Facts)

The `remember` / `forget` tool exposed as a simple CRUD list:

- Table: fact | created | actions (delete)
- "Add memory" button → inline form → calls `POST /api/admin/memory/fact`
- Dangerous — deleting a memory is permanent. Confirm dialog required.

---

### 3.3 Integrations

Where you wire up external services. Think of this as the connector marketplace — but just for me.

#### Layout

Two-column grid of integration cards. Each card:

```
┌─────────────────────────────┐
│  [Icon]  GitHub             │
│  Connected · rwgb           │
│                      [Edit] │
└─────────────────────────────┘
```

Status badge: `Connected`, `Not configured`, `Error` (with error message on hover).

#### Integration Detail (slide-over panel)

Clicking a card or `Edit` opens a slide-over (not a new page — context matters here) with:

- **Description**: what this integration does, what tools it enables
- **Config fields**: credentials, tokens, URLs — with "show/hide" toggle for secrets
- **Enabled tools**: list of tools this integration contributes to the ToolRegistry
- **Test connection**: fires a quick health check and shows pass/fail inline
- **Save / Disconnect** buttons

#### Initial Integration Targets

| Integration | What it unlocks |
|---|---|
| **Anthropic API** | Core — model key, current spend, rate limit status |
| **GitHub** | Repo access, PR/issue tools |
| **Slack** | Incoming/outgoing notifications |
| **Pushover / ntfy** | Mobile push alerts |
| **SMTP** | Email notifications |
| **Homelab / vCenter** | VM status tools (Ralph-specific — configurable endpoint) |
| **ESET Web Analyzer** | API key + base URL for the eset-web-analyzer project |
| **Custom HTTP** | Generic webhook/REST integration with auth config |
| **MCP Server** | External MCP tool server URL + auth |

**Adding a new integration** ("+ Add integration" button at top):

- Search or browse a catalogue of available integration types
- Select type → fills out the detail slide-over
- Save → writes config to `~/.koa/integrations.json` (or equiv)

---

### 3.4 Skills

Skills are tools registered in the ToolRegistry. This page makes that visible and manageable.

#### 3.4.1 Installed Skills

Table view:

| Skill | Source | Description | Status | Actions |
|---|---|---|---|---|
| `bash` | built-in | Run shell commands | ✅ Active | — |
| `engram_query` | built-in | Search Engram memory | ✅ Active | — |
| `read_file` | built-in | Read files | ✅ Active | — |
| `github_pr_review` | plugin | Review GitHub PRs | ✅ Active | Configure / Disable |
| `send_slack_message` | integration | Send a Slack message | ⚠️ No credentials | Configure |

Built-in skills are read-only. Plugin skills can be toggled and configured.

#### 3.4.2 Skill Marketplace / Install

A searchable catalogue of available skill packages. For now, this can be a curated static list — not a live package registry.

Each skill entry:

```
┌──────────────────────────────────────────────────┐
│  📨  send_email                                  │
│  Compose and send email via configured SMTP      │
│  Requires: SMTP integration                      │
│                                          [Install]│
└──────────────────────────────────────────────────┘
```

Installing:
1. Resolves dependencies (required integrations)
2. Warns if dependencies aren't configured
3. Writes skill config to disk, registers with ToolRegistry on next restart
4. Or, if hot-reloading is supported: registers immediately and shows confirmation

#### 3.4.3 Custom Skill Builder

A simple form to define a custom tool without writing TypeScript:

- Name, description, input schema (JSON editor)
- Execution type: `bash` (runs a shell command template), `http` (calls a configured URL), `mcp` (proxies to an MCP server)
- Test panel: fill inputs, fire the tool, see output

This is the "bring your own tool" escape hatch for things that don't fit the plugin model.

---

### 3.5 Notifications

Where you configure how and when I reach out to you.

#### 3.5.1 Channels

List of configured notification channels with status:

| Channel | Status | Test |
|---|---|---|
| Pushover | ✅ Connected | [Send test] |
| Slack DM | ✅ Connected | [Send test] |
| Email (SMTP) | ⚠️ Not configured | — |
| ntfy.sh | Not set up | — |

Each channel links back to its Integrations card (single source of truth for credentials).

#### 3.5.2 Notification Rules

When should I notify you? Table of trigger → channel mappings:

| Event | Channel | Condition | Actions |
|---|---|---|---|
| Long task complete | Pushover | Always | Edit / Delete |
| Agent error | Slack | Severity ≥ error | Edit / Delete |
| Daily summary | Email | 8:00 AM | Edit / Delete |
| Session cost > $0.50 | Pushover | Per session | Edit / Delete |

**Add rule** button → modal:
- Trigger type (dropdown): task complete, error, cost threshold, scheduled, custom event
- Condition (optional filter): e.g. cost > $X, task duration > N minutes, keyword in output
- Channel (dropdown of configured channels)
- Message template (with variable substitution: `{{task_name}}`, `{{duration}}`, `{{cost}}`)

#### 3.5.3 Quiet Hours

Simple time range picker — no notifications during these hours. Per-channel overrides allowed.

---

### 3.6 Activity

Observability. What have I actually been doing?

#### 3.6.1 Session Log

Paginated table of past sessions:

| Date | Duration | Turns | Cost | Summary |
|---|---|---|---|---|
| 2026-05-31 20:39 | 12m | 8 | $0.0021 | Rebuilt Engram client slug logic |
| 2026-05-31 20:21 | 4m | 2 | $0.0008 | Investigated brainExists() mismatch |

Click a row → Session Detail:
- Full message-by-message replay (read-only)
- Tool calls shown with inputs/outputs
- Token usage breakdown (input / output / cache read / cache write)
- Model used per turn (useful when smart routing is on)

#### 3.6.2 Tool Usage

Bar chart + table: which tools are called most, average execution time, error rate.

Useful for spotting: "why is bash taking 45 seconds on average?" or "engram_query is failing 30% of the time."

#### 3.6.3 Cost Dashboard

- **This session**: running total
- **Today / This week / This month**: grouped bar chart
- **By model**: sonnet vs haiku vs opus cost breakdown
- **Cache efficiency**: cache hit rate trend line

All costs are estimates based on published Anthropic pricing, labelled as such.

#### 3.6.4 Audit Log

Immutable log of all configuration changes made through the UI:

```
2026-05-31 20:41  [Settings]  compactAfterTurns changed: 10 → 15
2026-05-31 20:39  [Memory]    Fact added: "Ralph's project eset-web-analyzer..."
2026-05-31 19:12  [Skills]    Skill 'send_email' installed
```

---

### 3.7 Settings

Global configuration. Everything in `KoaConfig` exposed as a form.

#### 3.7.1 Agent

| Setting | Control | Notes |
|---|---|---|
| Default model | Dropdown (haiku / sonnet / opus + version) | Maps to `KOA_MODEL` |
| Max tokens | Number input | Maps to `KOA_MAX_TOKENS` |
| Smart routing | Toggle | Routes cheap queries to haiku automatically |
| Compact after N turns | Number input | Sliding window size |
| Max tool output chars | Number input | Truncation limit |

#### 3.7.2 Memory

| Setting | Control | Notes |
|---|---|---|
| Engram enabled | Toggle | Disabling skips all brain sync |
| SpiderBrain brain name | Text input | `SPIDERBRAIN_BRAIN` env var |
| Project path | Read-only path display | Set at startup; not runtime-editable |

#### 3.7.3 API Keys & Credentials

Separate section — visually distinct (slightly darker card, lock icon in heading):

- Anthropic API key — masked input with show/hide and "validate" button that fires a cheap test request
- Keys are stored via `koa config set` (writes to credentials file, not env vars)
- Shows key age and last-validated timestamp

#### 3.7.4 Web Console

| Setting | Control |
|---|---|
| Server port | Number input (requires restart) |
| CORS origin | Text input (dev server URL) |
| Theme | Toggle: Dark / Light / System |
| Compact sidebar by default | Toggle |

#### 3.7.5 Persona

Inline editor for `docs/PERSONA.md`:

- Raw markdown textarea with live preview split
- Character count, last-modified timestamp
- Save button writes the file directly (consistent with the existing self-edit exception for persona)
- "Reset to default" — restores the original Koa persona

---

## 4. Global Components

### Status Pill (top nav)
Real-time indicator, updated via SSE. States:
- `● Idle` — green
- `● Thinking` — amber, pulsing
- `● Running: bash` — amber, shows active tool name
- `● Error` — red, click to see last error

### Toast Notifications
Non-blocking feedback for async operations:
- ✅ "Checkpoint saved" (2s auto-dismiss)
- ✅ "Brain rebuild started — check Activity for progress"
- ❌ "Connection test failed: 401 Unauthorized"

### Confirmation Dialogs
Required for destructive actions:
- Deleting a memory
- Disconnecting an integration
- Disabling a built-in skill (warn: "this may break agent functionality")
- Clearing session history

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `G C` | Go to Chat |
| `G M` | Go to Memory |
| `G I` | Go to Integrations |
| `G S` | Go to Skills |
| `G A` | Go to Activity |
| `⌘ K` | Command palette |
| `⌘ ,` | Settings |

### Command Palette (`⌘K`)
Fuzzy search across all pages, actions, and settings. The escape hatch for power users who don't want to click through nav. Returns:
- Pages ("Go to Integrations")
- Actions ("Rebuild brain", "New session", "Send test notification")
- Settings ("Change model", "Toggle smart routing")
- Recent sessions

---

## 5. New API Endpoints Needed

The existing API covers chat. The admin UI needs additional endpoints:

```
GET  /api/admin/memory/facts         List all persistent facts
POST /api/admin/memory/fact          Add a fact
DEL  /api/admin/memory/fact/:id      Remove a fact

GET  /api/admin/memory/files         List project memory files + content
PUT  /api/admin/memory/:file         Write a project memory file

GET  /api/admin/integrations         List integrations + status
PUT  /api/admin/integrations/:id     Update integration config
POST /api/admin/integrations/:id/test  Test integration connection

GET  /api/admin/skills               List registered tools + source
POST /api/admin/skills/install       Install a skill package
PUT  /api/admin/skills/:name         Enable/disable/configure a skill

GET  /api/admin/sessions             List past sessions (paginated)
GET  /api/admin/sessions/:id         Session detail + replay

GET  /api/admin/activity/tools       Tool usage stats
GET  /api/admin/activity/cost        Cost breakdown by period

POST /api/admin/brain/rebuild        Trigger brain rebuild (SSE stream)
POST /api/admin/brain/sync           Force Engram sync

GET  /api/admin/config               Full KoaConfig (sanitised — no raw keys)
PUT  /api/admin/config               Update config values
POST /api/admin/config/validate-key  Test Anthropic API key
```

All admin endpoints should be on the `/api/admin/` prefix so they can be auth-gated separately if needed later.

---

## 6. Tech Choices

**Framework**: React (already in use). No new runtime dependency.

**Routing**: React Router v7 — adds proper URL-based navigation, back button support, deep-linking to specific sessions in the Activity log.

**UI components**: Start with a headless library (Radix UI or similar) styled with the existing CSS variables already defined in the web console. Don't bring in a full design system — it'll fight the existing aesthetic.

**Charts**: Recharts or Visx — lightweight, React-native. Only needed for Activity page.

**State**: Keep it simple. React Query (TanStack Query) for server state (integrations, sessions, config). Local `useState` for ephemeral UI state. No global store needed at this scale.

**Markdown editor**: CodeMirror with markdown mode for the Persona editor. Already likely in the dependency graph somewhere.

**SSE**: Reuse the existing streaming infrastructure for brain rebuild progress.

---

## 7. Phased Delivery

This is a lot. Here's a sensible order:

### Phase 1 — Foundations (do first)
- [ ] Add React Router; migrate Chat to `/chat` route
- [ ] Nav rail shell with placeholder pages
- [ ] Settings page (3.7) — it's pure config, no new data sources
- [ ] Status pill (global, high value)

### Phase 2 — Memory & Activity (high signal)
- [ ] Memory page: Engram panel (read-only first, then editable)
- [ ] Memory page: Project memory files
- [ ] Activity: Session log + cost dashboard
- [ ] New API endpoints for the above

### Phase 3 — Integrations & Notifications
- [ ] Integrations page with first 3 connectors (Anthropic, GitHub, Pushover)
- [ ] Notifications rules engine
- [ ] Quiet hours

### Phase 4 — Skills
- [ ] Installed skills table
- [ ] Enable/disable for non-built-ins
- [ ] Custom skill builder (simple bash/HTTP variant)

### Phase 5 — Polish
- [ ] Command palette
- [ ] Keyboard shortcuts
- [ ] Persistent facts CRUD
- [ ] Persona editor

---

## 8. What I'd Steal From Other UIs (Reference Inspiration)

| UI | What's worth borrowing |
|---|---|
| **Raycast** | Command palette behaviour, keyboard-first nav, clean typography |
| **Linear** | Status pill with tool-name cycling, activity feed density |
| **Vercel Dashboard** | Cost/usage charts, clean "not configured" empty states |
| **Cursor** | Tool call trace blocks (collapsed by default, expandable) |
| **Retool** | Integration card grid with status badges |

None of these aesthetically — just the UX patterns that work.

---

## 9. Open Questions

1. **Auth**: Right now the web console has no authentication. That's fine for localhost. If this ever gets deployed to the homelab and exposed beyond localhost, we need at minimum a passphrase. Should auth be in scope for Phase 1?

2. **Persistence for admin config**: Should integration configs write to `~/.koa/integrations.json`, the existing credentials file, or somewhere else? Needs a decision before implementing the endpoints.

3. **Skill packages format**: What does a "skill package" look like on disk? `.ts` file? `package.json` with an entry point? JSON schema + bash template? Needs a mini-spec of its own.

4. **Hot reload vs restart**: Can we register new skills at runtime without restarting the agent? The ToolRegistry is built in-process — feasible but needs careful thought about mid-turn tool list changes.

5. **Mobile**: The nav rail collapses okay, but chat on mobile is a separate concern. In scope?
