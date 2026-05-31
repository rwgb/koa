# Task: Hybrid Smart Model Routing with Haiku Pre-classifier

## Overview

Upgrade the smart model routing system in `src/agent/router.ts` to use a **hybrid approach**: keep the existing regex fast-path for clearly simple or clearly complex messages, and introduce a Haiku-powered semantic pre-classifier for the ambiguous `'moderate'` bucket. This makes routing semantically aware without paying a latency penalty on every turn.

---

## Background

The current `classifyMessage()` function in `src/agent/router.ts` is purely syntactic — it uses keyword regex and message length to assign a complexity tier. This works at the extremes but fails in the middle:

- `"fix it"` is short and matches nothing obvious, yet likely requires deep context → currently classified as `moderate` but could be `simple` or `complex`
- `"show me the refactored version"` hits both `SIMPLE_RE` and `COMPLEX_RE` — undefined behaviour
- The `recentToolUseCount >= 3` heuristic is a blunt instrument

The goal is to fix the `'moderate'` ambiguity by calling Haiku as a cheap semantic classifier, only for messages the regex cannot confidently resolve.

---

## Routing Decision Tree (target behaviour)

```
User message received
        │
        ▼
Has @haiku:/@sonnet:/@opus: prefix?
  YES → honour the override immediately, skip all classification
        │
        ▼ NO
smartRouting disabled?
  YES → use config.model directly, skip all classification
        │
        ▼ NO
Run regex classifyMessage()
        │
   ┌────┴────┐
SIMPLE    COMPLEX     → route directly (no Haiku call)
   └────┬────┘
        │
     MODERATE
        │
        ▼
Call classifyWithHaiku(message)   ← NEW
        │
   returns 'simple' | 'moderate' | 'complex'
        │
        ▼
Route to haiku / sonnet / opus
```

---

## Pipeline Instructions

Work through these phases **in order**. Do not merge changes from a later phase before the earlier phase's tests pass.

---

### Phase 1 — Core Logic (`src/agent/router.ts`)

**1.1 — Add `classifyWithHaiku()` async function**

Add a new exported async function:

```ts
export async function classifyWithHaiku(
  message: string,
  anthropicClient: Anthropic,
): Promise<MessageComplexity>
```

- Make a single non-streaming Anthropic API call using `claude-haiku-4-5-20251001`
- Max tokens: `16` (only needs to return a single digit)
- Temperature: `0` (deterministic)
- System prompt (exact):

```
You are a request complexity classifier. Given a user message, reply with exactly one digit:
1 = simple: factual lookup, short answer, no code changes, no reasoning chain needed
2 = moderate: some analysis, explanation, or minor code change
3 = complex: architecture decisions, multi-step reasoning, debugging, refactoring, or large code changes

Reply with only the digit. No other text.
```

- Parse the response: trim whitespace, take first character
  - `'1'` → `'simple'`
  - `'3'` → `'complex'`
  - anything else (including `'2'` or unexpected output) → `'moderate'`
- On any API error or timeout, **fall back to `'moderate'`** silently — never throw

**1.2 — Update `selectModel()` to be async**

Change signature to:

```ts
export async function selectModel(
  message: string,
  recentToolUseCount: number,
  config: { model: string; smartRouting: boolean },
  anthropicClient: Anthropic,
): Promise<{ model: string; tier: ModelTier; cleanMessage: string }>
```

- Keep existing fast-path logic unchanged for override prefix and `smartRouting: false`
- After `classifyMessage()` returns `'moderate'`, call `classifyWithHaiku()` to refine
- If `classifyMessage()` returns `'simple'` or `'complex'`, skip the Haiku call entirely

**1.3 — Do not change `classifyMessage()` or `extractTierOverride()`**

These are synchronous utilities used independently in tests. Leave their signatures untouched.

---

### Phase 2 — Agent Loop (`src/agent/loop.ts`)

Update the `turn()` method where `selectModel()` is called (currently around line 210):

- `selectModel()` is now async — `await` it
- Pass `this.anthropic` (or equivalent Anthropic client instance) as the fourth argument
- The `turn()` method is already async — no signature change needed
- Ensure the `cleanMessage` assignment and downstream usage is unchanged

---

### Phase 3 — Configuration (`src/config/index.ts`)

No new config keys are needed — `smartRouting` already controls the feature. However:

- Confirm `KOA_SMART_ROUTING` env var is wired to `config.smartRouting` (it should already be)
- Add a `HAIKU_CLASSIFIER_TIMEOUT_MS` config constant defaulting to `3000` — pass this as an `AbortSignal` timeout to the Haiku API call so a slow response never blocks a turn indefinitely

---

### Phase 4 — Tests (`src/__tests__/router.test.ts`)

**4.1 — Existing synchronous tests**

All existing tests for `extractTierOverride`, `classifyMessage`, and `selectModel` (with `smartRouting: false` and override paths) **must continue to pass unchanged**. These code paths never reach `classifyWithHaiku`.

**4.2 — New unit tests for `classifyWithHaiku`**

Mock the Anthropic client. Test:

- Response `'1'` → returns `'simple'`
- Response `'3'` → returns `'complex'`
- Response `'2'` → returns `'moderate'`
- Response `'  2  '` (whitespace) → returns `'moderate'` (trim handling)
- Response `'banana'` → returns `'moderate'` (unexpected output fallback)
- API throws → returns `'moderate'` (error fallback, does not throw)

**4.3 — New unit tests for `selectModel` with smart routing + moderate path**

Mock `classifyWithHaiku`. Test:

- A message that `classifyMessage` returns `'moderate'` for → `classifyWithHaiku` is called exactly once
- A message that `classifyMessage` returns `'simple'` for → `classifyWithHaiku` is **not** called
- A message that `classifyMessage` returns `'complex'` for → `classifyWithHaiku` is **not** called
- When `classifyWithHaiku` returns `'simple'` for a moderate message → routes to haiku
- When `classifyWithHaiku` returns `'complex'` for a moderate message → routes to opus

**4.4 — Test file**

Add new tests to the existing `src/__tests__/router.test.ts`. Do not create a separate file.

---

### Phase 5 — UI/UX (`src/tui/App.tsx` and web console)

The UI already displays the active tier per turn. No new UI components are needed, but:

- In the TUI, when smart routing is on and a Haiku pre-classifier call is in flight, show a brief status indicator: `classifying…` before the main streaming begins. This should appear in the same location as the existing `thinking…` / `working…` state.
- In the web console (if SSE events are used), emit a new SSE event type `{ type: 'classifying' }` from the server before the Haiku call, and `{ type: 'classified'; tier: string }` after it resolves. The frontend should display this as a subtle label (e.g. a muted badge: `→ sonnet` or `→ haiku`) that disappears once streaming starts.
- The `activeModel` field in the API response (documented in `docs/API.md`) should reflect the final routed model, not haiku — haiku is a utility call, not the active model.

---

### Phase 6 — Security Review

Before merging, confirm:

- The Haiku classifier prompt contains **no user data beyond the raw message text** — no session state, no memory contents, no file contents. The message is the only input.
- The Anthropic API key used for the classifier call is the same key already in use — no new credential surface.
- The classifier response is parsed defensively (already handled by the fallback-to-moderate logic) — no eval, no dynamic code execution on the response.
- The `HAIKU_CLASSIFIER_TIMEOUT_MS` cap (Phase 3) is enforced to prevent the classifier from blocking indefinitely.
- Confirm no classifier response content is logged at any level — only the resolved tier label.

---

### Phase 7 — Observability

- Log the routing decision at `debug` level on each turn:
  ```
  [router] tier=sonnet source=haiku-classifier latency=312ms
  [router] tier=haiku source=regex-fast-path
  [router] tier=opus source=override
  ```
  `source` should be one of: `override`, `regex-fast-path`, `haiku-classifier`, `config`
- Track per-session classifier call count and total latency in the existing usage/cost tracking (`src/agent/usage.ts`) — haiku classifier tokens should be broken out separately so cost attribution is clear
- Emit a `classifierLatencyMs` field in the `TurnResult` so the admin UI can surface average classifier latency over time

---

## Acceptance Criteria

- [ ] All existing router tests pass without modification
- [ ] New classifier tests pass (mocked Anthropic client)
- [ ] `classifyWithHaiku` is never called when the result is `'simple'` or `'complex'` from regex
- [ ] `classifyWithHaiku` is never called when `smartRouting` is `false`
- [ ] `classifyWithHaiku` is never called when a tier override prefix is present
- [ ] API errors in the classifier always fall back to `'moderate'` — never surface to the user
- [ ] Classifier timeout is respected (≤ `HAIKU_CLASSIFIER_TIMEOUT_MS`)
- [ ] `activeModel` in API response always reflects the main model, not haiku
- [ ] Routing decision is logged at `debug` level with `source` field
- [ ] Classifier token usage is tracked separately in cost reporting
- [ ] TUI shows `classifying…` state when classifier is in flight
- [ ] All TypeScript strict checks pass (`tsc --noEmit`)
- [ ] Full test suite passes (`npm test`)

---

## Files Expected to Change

| File | Change |
|---|---|
| `src/agent/router.ts` | Add `classifyWithHaiku()`, make `selectModel()` async |
| `src/agent/loop.ts` | Await `selectModel()`, pass Anthropic client, emit `classifying` event |
| `src/config/index.ts` | Add `HAIKU_CLASSIFIER_TIMEOUT_MS` constant |
| `src/agent/usage.ts` | Add classifier token tracking |
| `src/__tests__/router.test.ts` | Add classifier and updated selectModel tests |
| `src/tui/App.tsx` | Add `classifying…` status state |
| `src/server/events.ts` | Add `classifying` and `classified` SSE event types |
| `src/server/index.ts` | Emit new SSE events around classifier call |

**Do not modify** `docs/API.md` until the implementation is complete — update it as the final step to reflect `classifierLatencyMs` in `TurnResult`.
