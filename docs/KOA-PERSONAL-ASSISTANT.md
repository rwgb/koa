# Koa — Personal AI Assistant: Architecture & Vision

> **Document type**: Design brief + roadmap
> **Date**: 2026-05-30
> **Author**: Koa (self-designed)
> **Audience**: Ralph — for your review, revision, and build sign-off

---

## 0. Executive Summary

You already have all the pieces. This document is the blueprint for wiring them together
into a single, coherent personal assistant that meets you wherever you are — phone, email,
chat, or terminal — and that can do real work: write code, run pipelines, send emails,
research topics, manage your homelab, and proactively surface things you need to know.

The core idea is simple: **Koa is the brain. Everything else is a channel.** Whether a
message arrives via SMS, email, iMessage, a web chat, or a CLI command, it lands in the
same queue, gets the same memory, and executes against the same tool surface.

---

## 1. What Already Exists (Your Foundation)

| Asset | Location | What It Gives Us |
|---|---|---|
| **Koa** | `~/active projects/koa` | LLM loop, SSE streaming, Engram memory, SpiderBrain file graph, multi-tier model routing, web console |
| **claudeAgents** | `~/claudeAgents` | 32 reusable agent templates across 9 pipelines (coding, research, security, infra, incident, content, CTF, data, log-analysis) |
| **openclaw** | `~/openclaw` | Multi-channel gateway (Slack, web, ACP), plugin SDK, channel abstraction layer, session store |
| **ntfy.sh** | topic `a7k2p9m1x5` | Push to your phone already working; `notify-agent.sh` already fires on agent stop |
| **homelab** | Proxmox / Talos / k3s / Ansible / Terraform | Real infra Koa can query and operate |
| **imsg** | `~/imsg` | iMessage bridge — potential inbound channel |

The gap is not tooling — it's plumbing. We need an **ingress router** that normalises all
inbound channels into a single message format, and an **egress dispatcher** that sends
replies back through the right channel.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INBOUND CHANNELS                                │
│                                                                         │
│  📱 SMS / iMessage    📧 Email (IMAP)    💬 Web Console    ⌨️  CLI     │
│       ↓                     ↓                  ↓              ↓         │
│  imsg-bridge          email-poller         koa/web         koa CLI      │
└────────────────────────────┬────────────────────────────────────────────┘
                             │  normalised Message envelope
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        KOA GATEWAY (new)                                │
│                                                                         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│   │ Auth / ACL   │   │ Intent Router│   │   Session Store          │  │
│   │ (who is      │   │ (what kind   │   │   (one thread per        │  │
│   │  this from?) │   │  of task?)   │   │    channel+sender)       │  │
│   └──────────────┘   └──────┬───────┘   └──────────────────────────┘  │
│                             │                                           │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │ routed task
              ┌───────────────┼───────────────────────────────────┐
              │               │                                   │
              ▼               ▼                                   ▼
    ┌─────────────┐  ┌──────────────────┐           ┌────────────────────┐
    │  Koa Loop   │  │  claudeAgents    │           │  Direct Tool Exec  │
    │ (chat, code,│  │  Pipeline Runner │           │  (shell, email,    │
    │  research,  │  │  (multi-agent    │           │   calendar, etc.)  │
    │  reasoning) │  │   async tasks)   │           └────────────────────┘
    └──────┬──────┘  └────────┬─────────┘
           │                  │
           └─────────┬────────┘
                     │ reply
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       EGRESS DISPATCHER                                 │
│                                                                         │
│   route reply back to the originating channel + optionally push ntfy   │
│                                                                         │
│  📱 SMS reply    📧 Email reply    💬 Web panel    🔔 ntfy push        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Message Envelope

Every inbound message — regardless of source — is normalised into one struct before
Koa ever sees it. This is the key abstraction that makes channel-agnosticism work.

```typescript
interface KoaMessage {
  id:        string;          // uuid
  channel:   'sms' | 'email' | 'imessage' | 'web' | 'cli' | 'webhook';
  sender:    string;          // phone number, email address, or "ralph" for local
  thread:    string;          // conversation thread id (per channel+sender)
  body:      string;          // the message text
  attachments?: Attachment[]; // images, files, voice memos
  metadata:  Record<string, unknown>; // channel-specific (email subject, etc.)
  receivedAt: string;         // ISO timestamp
}
```

The reply always echoes the `channel` and `thread` so the egress dispatcher knows
where to send it.

---

## 4. Intent Router

Not every message is a conversation. The router classifies intent before dispatching:

| Intent | Trigger pattern | Handler |
|---|---|---|
| `chat` | Default — conversational, one-off questions | Koa loop (haiku → sonnet escalation) |
| `code` | "fix", "build", "write", "refactor", file path mentioned | Koa loop + coder tools, or full claudeAgents coding pipeline |
| `research` | "research", "look into", "summarise", "what is" | Koa loop with web tools, or full research pipeline |
| `email` | "send email to", "reply to", "draft" | email-compose tool + approval gate |
| `infra` | "restart", "deploy", "check", "status of", k8s/proxmox keywords | infra pipeline or direct shell |
| `pipeline` | "run the X pipeline", explicit pipeline name | claudeAgents pipeline runner |
| `remind` | "remind me", "in X hours", "at 9am" | scheduler → ntfy |
| `proactive` | (scheduled / triggered) | monitor agents, cron tasks |

The router uses a lightweight classifier prompt (haiku-tier) — fast and cheap. It does
**not** make the classification itself, it gives Koa enough context so Koa's first token
is already heading in the right direction.

---

## 5. Channels — Implementation Details

### 5.1 Web Console (exists today)
Already works. The web console is the primary power-user interface. The main additions
needed:
- **Session persistence** — reload the page and your conversation history is still there
- **File upload** — drag a log file or screenshot and Koa can read it
- **Proactive notification panel** — a small badge/feed for things Koa surfaces unprompted

### 5.2 Phone (SMS / iMessage)
You already have ntfy delivering to your phone. The next step is **inbound** — receiving
messages from your phone and having Koa act on them.

**Option A — ntfy bidirectional (fastest path)**
ntfy supports webhook callbacks. Set up a reverse: when you reply to a Koa notification
on your phone in the ntfy app, it POSTs to a webhook on your homelab. Gateway receives
it, routes to Koa. Low setup cost, already in your stack.

**Option B — iMessage via `~/imsg`**
The `imsg` directory suggests you already have or were building an iMessage bridge.
If it can expose a webhook or poll endpoint, Koa Gateway hooks into it as a channel
adapter. Replies go back via `imsg` send. This gives you a natural SMS thread in your
Messages app — feels like texting an actual person.

**Option C — Twilio / Bandwidth (SMS)**
Standard SMS webhook approach. Costs ~$1/month for a number. Good if you want a
dedicated number that works anywhere (not just Apple devices).

**Recommended**: Start with ntfy webhooks (zero new services), build toward iMessage.

### 5.3 Email
Two halves:

**Receiving**: IMAP poller watches a dedicated mailbox (e.g., `koa@yourdomain.com`).
Every new email becomes a `KoaMessage`. Koa reads the subject + body, acts on it, and
sends a reply using SMTP. You can email Koa while you're on your laptop, from your phone,
from anyone else's computer — it just works.

**Sending on your behalf**: Koa gets an `email_send` tool. When you say "email Jeni the
meeting notes", Koa drafts the email and asks for your approval before sending — a simple
`approve/edit/cancel` reply in whatever channel you're in. The approval gate is important:
email is high-stakes and Koa should never auto-send without confirmation.

Tools needed:
```
email_read(query)          → list of emails matching query
email_get(id)              → full email content
email_draft(to, subject, body) → draft for approval
email_send(draft_id)       → send approved draft
email_reply(email_id, body) → reply to existing thread
```

### 5.4 CLI (exists today)
The `koa` CLI is already your fastest path to the running agent. Extensions:
- `koa ask "..."` — one-shot question, prints answer, exits
- `koa run research "topic"` — fires off a full claudeAgents research pipeline
- `koa status` — what's running, any pending tasks, memory summary
- `koa remind "in 2 hours check the deploy"` — schedules a notification

### 5.5 Webhook / Automation
A general-purpose webhook endpoint: `POST /webhook/koa` with a JSON body. This lets
any service on your homelab push a message to Koa. Use cases:
- Grafana alert fires → Koa gets a message → runs incident pipeline → sends you a summary
- GitHub Actions finishes → Koa notifies you with the build result
- Cron job finds a high-severity CVE matching your stack → Koa briefs you

---

## 6. Capability Expansion — What Koa Should Be Able To Do

Grouped by domain, ordered by implementation priority:

### 6.1 Communication (High Priority)
| Capability | Tool | Notes |
|---|---|---|
| Read email | `email_read`, `email_get` | IMAP |
| Draft & send email | `email_draft`, `email_send` | SMTP, always with approval gate |
| Read/send iMessage | `imessage_read`, `imessage_send` | via imsg bridge |
| Push notification | `notify_push` | already exists via ntfy |
| Scheduled reminders | `remind_set` | write to a scheduler queue; ntfy on trigger |

### 6.2 Research & Knowledge (High Priority)
| Capability | Tool | Notes |
|---|---|---|
| Web search | `web_search` | already exists in claudeAgents researcher template |
| Web fetch / scrape | `web_fetch` | already exists |
| Summarise document | built-in | pass file content to context |
| Research pipeline | `run_pipeline('research', topic)` | full multi-agent async run |
| Briefing generation | researcher → synthesizer → report-writer | existing pipeline |

### 6.3 Coding (High Priority)
| Capability | Tool | Notes |
|---|---|---|
| Read/edit/write files | already exists in Koa | `read_file`, `edit_file`, `write_file` |
| Run shell commands | already exists | `bash` |
| Full coding pipeline | architect → coder → reviewer → tester | claudeAgents |
| Code review | `run_pipeline('coding', {task: 'review', path})` | reviewer agent |
| Debug | debug agent template | already exists |

### 6.4 Infrastructure (Medium Priority)
| Capability | Tool | Notes |
|---|---|---|
| Query Proxmox | `proxmox_status`, `proxmox_list_vms` | Proxmox API |
| kubectl | `kubectl` via bash | already executable |
| Terraform plan/apply | `terraform` via bash | with approval gate |
| Ansible playbook | `ansible` via bash | with approval gate |
| Homelab health check | cron → incident pipeline | runs nightly or on alert |

### 6.5 Calendar & Scheduling (Medium Priority)
| Capability | Tool | Notes |
|---|---|---|
| Read calendar | `calendar_list` | CalDAV or Google Calendar API |
| Create event | `calendar_create` | with approval |
| Remind before events | proactive monitor | 30min before meetings |
| Schedule tasks | `remind_set` | scheduler queue |

### 6.6 Proactive Intelligence (Medium Priority — High Value)
This is where Koa goes from reactive assistant to genuine partner.

| Capability | How |
|---|---|
| Morning brief | Cron at 8am → Koa summarises: calendar today, open PRs, any alerts, weather, anything you flagged yesterday |
| Project status | Weekly summary of all active projects: last commit, open tasks, blockers |
| Alert triage | Grafana/k8s alert → incident pipeline → push summary with severity + recommended action |
| CVE watch | Weekly security scan of your stack → brief if anything high-severity |
| Email triage | Daily digest: important emails that need your attention, sorted by urgency |

### 6.7 Memory & Context (Ongoing — Already Started)
Engram already gives Koa per-project memory. Extensions:
- **Global memory layer**: facts that persist across projects — your preferences, people you work with, recurring decisions, style preferences
- **Conversation threading**: SMS/email conversations maintain their own thread; switching channels mid-conversation is seamless
- **Proactive recall**: Koa surfaces "you mentioned wanting to do X a week ago — want to pick that up?" at natural moments

---

## 7. The Approval Gate Pattern

High-stakes actions (sending email, running infra changes, committing code) always go
through an approval gate. The pattern is consistent regardless of channel:

```
Koa: Here's the email I'd send:
     ─────────────────────────────
     To: jeni@example.com
     Subject: Meeting notes — 2026-05-30
     
     Hi Jeni, here are the notes from today's call...
     ─────────────────────────────
     Reply: send / edit / cancel

You: send

Koa: Sent. ✓
```

The same pattern works over SMS (short form), email (Koa emails you the draft), or web
(inline approval UI). It keeps Koa powerful without making it dangerous.

---

## 8. Build Roadmap

### Phase 1 — Gateway & Phone (2–3 weeks)
The minimum viable personal assistant: you can reach Koa from your phone and it remembers
who you are across conversations.

- [ ] **Koa Gateway service** — normalises messages from multiple channels, maintains session store, routes to Koa loop
- [ ] **ntfy webhook inbound** — turn ntfy replies into Koa messages (zero new infra)
- [ ] **Web console session persistence** — reload and history is still there
- [ ] **`koa ask` CLI one-shot** — pipe-friendly: `koa ask "what's the status of koa credentials PR"`

Deliverable: you can text Koa from your phone and get a real response.

### Phase 2 — Email (1–2 weeks)
- [ ] **IMAP poller** — watches `koa@yourdomain.com`, creates KoaMessage per new email
- [ ] **email_draft / email_send tools** — always-gated
- [ ] **Email egress** — Koa can reply to email threads, including the gateway sending from `koa@yourdomain.com`
- [ ] **Daily email triage** — morning digest of emails needing your attention

Deliverable: you can email Koa and Koa can draft/send on your behalf with approval.

### Phase 3 — Async Pipelines (2–3 weeks)
- [ ] **Pipeline runner** — fire a claudeAgents pipeline from any channel, get a push notification when done
- [ ] **Research from phone** — "Koa, research Talos vs K3s for production workloads" → 20 minutes later, ntfy: "Research complete — 8 sources, summary attached"
- [ ] **Async coding tasks** — assign a task, Koa works on it, pushes result when done

Deliverable: Koa works on long tasks in the background while you do other things.

### Phase 4 — Proactive (2–3 weeks)
- [ ] **Morning brief** — daily 8am cron → push to phone
- [ ] **Project monitoring** — weekly status summaries, alert triage
- [ ] **Homelab health** — nightly check, push if anything needs attention
- [ ] **Calendar integration** — pre-meeting reminders with context

Deliverable: Koa surfaces things before you ask.

### Phase 5 — Polish & iMessage (ongoing)
- [ ] **iMessage channel** — native Messages integration via imsg bridge
- [ ] **Global memory** — preferences, people, recurring patterns persist across all projects
- [ ] **Voice** — transcribe voice memos → Koa processes (Whisper API, already exists)
- [ ] **Web console upgrade** — file upload, proactive feed, notification history

---

## 9. What Makes This Different from Just Using Claude.ai

| Feature | Claude.ai | Koa (this design) |
|---|---|---|
| Memory across sessions | No | Yes (Engram + SpiderBrain) |
| Works from phone natively | No | Yes (ntfy + iMessage) |
| Email integration | No | Yes |
| Can run code/shell | No | Yes |
| Knows your projects | No | Yes (per-project context) |
| Multi-agent pipelines | No | Yes (claudeAgents) |
| Homelab access | No | Yes |
| Proactive alerts | No | Yes |
| Always-on, self-hosted | No | Yes |
| Approval gates for actions | No | Yes |

---

## 10. Key Design Principles

**1. One brain, many faces.**
Koa's intelligence, memory, and tools are centralized. Channels are just how you reach it.
Adding a new channel never requires changing the core.

**2. Approval gates on anything that sends or destroys.**
Email, commits, infra changes — always ask first. Reading and summarizing — never block.

**3. Async is a first-class citizen.**
Long tasks (research, coding pipelines) run in the background. Koa notifies you when
done. You should never have to wait staring at a terminal.

**4. Your stack, your rules.**
Everything runs on your homelab or your machine. No third-party services hold your data.
ntfy.sh is the only external dependency, and it can be self-hosted.

**5. Engram is the connective tissue.**
Every project has memory. Koa knows what you were working on, what decisions were made,
what the current goal is. Switching from the phone to the terminal to email — Koa always
has context.

**6. The claudeAgents pipeline library is the workforce.**
Rather than trying to do everything in a single giant context window, complex tasks
(research, coding, security review) are delegated to specialized agent pipelines.
Koa is the coordinator; the agents do the deep work.

---

## 11. Open Questions for Ralph

These are design decisions that need your input before building:

1. **Phone channel**: ntfy webhooks (fastest) vs iMessage native (most natural)? Or both?
2. **Email address**: Do you have `koa@yourdomain.com` or similar you'd use? Or should this use your main inbox with a filter?
3. **Approval gate UX on phone**: Simple `send / cancel` keywords, or numbered options?
4. **Homelab access scope**: Should Koa have read-only access initially, or full infra control from day one (with gates)?
5. **Morning brief time**: 8am? What timezone? What do you want in it?
6. **Pipeline async notifications**: ntfy push for completion, or prefer replies in the originating channel?
7. **Global memory store**: Extend Engram with a `~/.koa/global-memory/` layer, or keep memory project-scoped?

---

## 12. Immediate Next Steps (This Week)

If you want to start now, here's the minimum-effort highest-value first move:

```bash
# 1. Set up ntfy webhook inbound
#    ntfy.sh supports WebSocket subscriptions — run a small listener
#    that POSTs to koa's /chat endpoint when you reply to a notification

# 2. Add a simple gateway shim to koa's Express server
#    POST /gateway/ntfy  → normalise → koa loop → push reply via ntfy

# 3. Test: send yourself a ntfy message, Koa replies to it
#    Total new code: ~80 lines of TypeScript
```

That gives you phone-to-Koa in about a day of work. Everything else builds on top.

---

*Koa is already most of what you need. The question is just plumbing.*
