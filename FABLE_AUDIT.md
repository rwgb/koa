# Koa — Fable Audit Prompt

You are Claude Fable 5 performing a deep audit of the **Koa** project: a personal AI assistant CLI and web console built on TypeScript/Node.js. It runs an Anthropic agent loop with layered memory (Engram + SpiderBrain), tool-use dispatch, specialist agents, and an Express HTTP server.

Read the files listed in each section before producing findings. Work through all three audits. For each finding, provide:
- **File:line** reference
- **Severity**: Critical / High / Medium / Low
- **Description** of the issue
- **Recommended fix** (concrete, not generic)

---

## Context Files — Read First

- `ARCHITECTURE.md` — system diagram, agent loop lifecycle, tool registry, memory layers
- `src/agent/loop.ts` — main agent loop (tool-use while loop, prompt caching, system prompt assembly)
- `src/agent/router.ts` — model routing / complexity classifier
- `src/agent/specialists.ts` — specialist agent personas and system prompts
- `src/server/index.ts` — Express HTTP server
- `src/server/routes/` — all route handlers
- `src/config/index.ts` — config loading and defaults
- `src/config/credentials.ts` — credential management
- `src/db/index.ts` — SQLite database layer
- `src/db/schema.ts` — table definitions
- `src/db/migrations.ts` — migration logic
- `src/tools/` — tool registry and individual tool implementations
- `src/memory/store.ts` — in-memory user memory
- `src/project-memory/store.ts` — project memory / HANDOFF writes
- `src/__tests__/` — test suite

---

## Audit 1 — Security Review

Focus areas:

**Input validation & injection**
- Command injection in bash/shell tool handlers — are user-controlled strings ever interpolated into shell commands?
- SQL injection in `src/db/` — parameterised queries everywhere?
- Prompt injection — does any tool output get fed back into the system prompt without sanitisation?
- Path traversal in file tools — are paths validated/normalised before use?

**SSRF & network**
- `src/__tests__/ssrf.test.ts` exists — read it and verify the production code it covers actually enforces the same rules
- Any `fetch`/`axios`/`http` calls that accept a user-supplied URL — are they validated against an allowlist or blocked to private ranges?

**Authentication & secrets**
- `src/config/credentials.ts` and `src/server/` — are API routes authenticated? Which ones, and how?
- Are secrets ever logged, included in error responses, or stored in plaintext outside `~/.koa/`?
- Is the Anthropic API key ever exposed in tool output or SSE events sent to the browser?

**Session & web console**
- `src/server/routes/` — CSRF exposure on state-mutating POST routes?
- SSE endpoint — can unauthenticated clients subscribe?
- Are CORS headers appropriately scoped?

**Dependency surface**
- Note any obviously high-risk npm packages (e.g., `eval`, `vm`, `child_process` wrappers) and whether their usage is guarded.

---

## Audit 2 — QA / Test Coverage Review

Focus areas:

**Coverage gaps**
- Read `src/__tests__/` in full. List modules in `src/` that have **no test file**.
- List modules that have a test file but where the happy path, error path, or a security-relevant branch is untested.

**Test quality**
- Are tests making real assertions or just checking that functions don't throw?
- Are any tests relying on implementation details that will break on refactor?
- Any tests that mock the database when they should hit a real SQLite in-memory instance (given the project's stated preference for integration over mocks)?

**Type safety**
- Identify `any` casts or type assertions (`as X`) in `src/` that suppress genuine type errors rather than being intentional escape hatches.
- Are there runtime values from the Anthropic API response that are accessed without narrowing their type first?

**Error handling**
- Tool handlers in `src/tools/` — do they propagate errors with context, or swallow them silently?
- Database migrations in `src/db/migrations.ts` — is there a rollback path, or is it forward-only with no recovery?

**Build & lint**
- Note any patterns that would fail `tsc --noEmit` or ESLint (don't run the commands; infer from reading the code).

---

## Audit 3 — Architecture & Design Review

Focus areas:

**Agent loop (`src/agent/loop.ts`)**
- The tool-use while loop: is there a maximum iteration guard? What happens on runaway tool-call chains?
- Prompt caching strategy: is the cache breakpoint placed correctly (stable content before volatile content)? Would a timestamp or per-request value ever invalidate the cache unexpectedly?
- Token accumulation: does the loop handle `max_tokens` truncation gracefully, or does it silently lose output?

**Memory architecture**
- `src/memory/store.ts` caps at 200 entries — is the eviction policy correct? What gets dropped first?
- `src/project-memory/store.ts` writes HANDOFF.md atomically — is there a race condition if two concurrent turns both call `writeHandoff()`?
- Engram context injection via `buildSystemPromptInjection()` — is there a size cap? Could a large brain corrupt the prompt or blow past the context window?

**Routing & specialist dispatch**
- `src/agent/router.ts` uses a single-digit classifier — what happens on classifier error or unexpected output? Is the fallback safe?
- `src/agent/specialists.ts` — are specialist system prompts additive on top of the base prompt, or do they replace it? Clarify and flag if it creates prompt conflicts.

**Server & scalability**
- `src/server/index.ts` — is the server designed for a single user or multi-user? If single-user, are there guards that enforce that assumption?
- SSE streaming: are connections cleaned up on client disconnect? Is there a leak risk on long-running tool calls?
- SQLite in a web server context — is there write serialisation, or can concurrent requests cause locking errors?

**Configuration & portability**
- `src/config/index.ts` — are all required config fields validated at startup with clear error messages, or do missing values surface as cryptic runtime errors mid-turn?
- `install.sh` — does it make assumptions about the runtime environment (macOS only, specific Node version, etc.) that are not documented?

---

## Output Format

Produce three sections, one per audit. Within each section, group findings by severity (Critical → High → Medium → Low). End each audit with a one-paragraph summary of the overall health of that dimension.

After all three audits, add a **Top 5 Recommendations** section: the five highest-leverage actions across all three audits, ranked by impact.
