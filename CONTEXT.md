# Koa — Domain Glossary

> Canonical terminology for the Koa project. Implementation details belong in ARCHITECTURE.md, not here.

---

## Koa

An autonomous personal assistant. Its primary identity is the agent loop and memory system. The CLI and web console are one inbound channel among many. Koa acts on behalf of the user across communication channels, not just responds to chat.

## Agent Loop

The core execution cycle: initialize (load memory, inject context) → turn (LLM call + tool execution) → finalize (persist memory, generate journal). One loop instance per server process.

## Provider

An LLM backend. Koa routes each turn to a provider based on configuration. Providers translate between Koa's internal Anthropic-typed message format and the backend's wire format. Four named types exist: `anthropic`, `claude-code`, `google`, and `openai-compatible`. See ADR-0003.

## OpenAI-Compatible Provider

A provider that speaks the OpenAI `/v1/chat/completions` API. A single implementation covers Ollama, OpenRouter, Groq, Together AI, Fireworks, vLLM, and OpenAI direct. Configured with a base URL, API key, and model list.

## Model Tier

A routing abstraction over concrete model IDs: `fast` (Haiku), `standard` (Sonnet), `powerful` (Opus). Tiers decouple routing logic from model versioning.

## Channel

An inbound or outbound communication path. Inbound channels: web console, CLI, SMS, Telegram, Gmail, webhooks. Outbound channels: ntfy, Slack, Telegram, Gmail, APNs. The agent loop is channel-agnostic; channels normalize messages into a common envelope.

## Turn

One round-trip through the agent loop: a user message in, zero or more tool calls, an assistant response out. A session consists of many turns.

## Session

A continuous conversation within a single agent loop lifecycle — from `initialize()` to `finalize()`. Sessions persist to the conversation database and generate journal entries on close.

## Memory (Working Tier)

Per-session markdown files: `PROJECT.md` (static project context), `STATE.md` (current progress), `HANDOFF.md` (cross-session state). Injected statically at session start.

## Memory (Episodic Tier)

180-day rolling store of journal entries, session decisions, and STATE.md snapshots. Backed by SQLite. Queried per-turn using the current message as the retrieval key. See ADR-0001.

## Memory (Semantic Tier)

Permanent consolidated facts extracted from the episodic tier by the consolidation sweep. Backed by SQLite. Queried per-turn alongside the episodic tier.

## Global Memory

The `~/.koa/memory.db` database. Stores facts that are true regardless of project context: user preferences, standing orders, boundaries, assertions about the user's world. See ADR-0002.

## Project Memory

The `~/.koa/projects/<slug>/memory.db` database. Stores facts scoped to a specific project: decisions, failures, resolved uncertainties, journal entries. See ADR-0002.

## Learning Event

A typed, immediately-persisted write to memory triggered by a specific interaction pattern. Types: `correction`, `preference`, `resolved`, `assertion`, `decision`, `failure`, `standing-order`, `boundary`. Typed events fire at interaction time; session-end journal entries cover everything else.

## Correction

A learning event written when Koa was wrong and a behavior change is needed. Also auto-detected from: repeated rephrasing, file edits after Koa output, tool failures.

## Preference

A learning event written when the user confirms an approach without pushback. Stored in global memory.

## Assertion

A learning event written when the user states a durable fact about their world mid-conversation. E.g. "my server IP is 192.168.1.200", "John is my DevOps colleague." Stored in global memory. Subject to at-write dedup check.

## Standing Order

A persistent instruction about how Koa should operate. Stored in global memory. Evaluated against the event bus; triggers autonomous actions when matched. Subject to at-write dedup check.

## Boundary

A privacy or security constraint. A type of learning event stored in global memory. E.g. "never store X", "don't mention Y to anyone." Fires an immediate write; never deferred to session end.

## Event Bus

The internal message bus through which system events flow. Events follow a `namespace.verb` naming convention (e.g. `deploy.failed`, `task.blocked`). Standing orders register against event patterns (exact match or `namespace.*` prefix wildcard) to trigger autonomous actions.

## Delegation

A scheduled autonomous action stored in the database. Evaluated every 5 minutes. Distinct from standing orders: delegations are schedule-based, standing orders are event-triggered.

## Label

The human-readable display name for a delegation. Shown in the UI; not evaluated programmatically.

## Action Type

The execution mode for a standing order when its trigger fires: `notify` (ntfy/curl, no LLM), `brief` (Haiku summarization), or `agent` (full loop turn). Inferred from the standing order's natural language at write time.

## Priority Lanes

The two-queue scheduling system for the agent loop. User-initiated turns run in the high-priority lane and preempt the autonomous lane. Autonomous turns (delegations, briefings, channel inbound) run in the low-priority lane. See ADR-0004.

## Self-Healing

Koa's ability to detect and repair failures within its own process boundary without user intervention. Scoped strictly to Koa internals: integration re-auth, memory reconciliation, config drift. Never touches user systems without an approval gate. See ADR-0005.

## Self-Extending

Koa's ability to draft new plugins when it detects a capability gap mid-task. Drafts are staged for user approval before registration. Execution is sandboxed via the plugin system (bash subprocess, env-var input only).

## Trust Boundary

The line separating what Koa can do unilaterally (within its own process) from what requires user approval (external systems, new executable code). See ADR-0005.

## Untrusted Content

Output from external sources (fetched web pages, web search results, MCP tool results) that may contain prompt injection. Wrapped with `wrapUntrusted()` before being returned to the agent loop. MCP servers can be individually marked trusted via config. See ADR-0006.

## Consolidation Sweep

A background process (at most weekly) that extracts durable facts from the episodic tier into the semantic tier and deletes expired chunks. Handles contradiction detection for most memory types.

## Poor Recall

A signal emitted when memory retrieval returns no relevant results for a query. Surfaces as a `<memory_gap>` block in the system prompt, giving the agent explicit permission to ask the user for prior context rather than fabricating continuity.

## StreamId

A per-turn identifier used for SSE reconnection. The server buffers streamed output for the duration of a turn; a reconnecting client sends the `streamId` to resume playback from the last received position.
