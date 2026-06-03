## Tasks — v6 CP10: Autonomous Operations & Hardening

> **Position**: CP0–CP9 complete (Foundation → Accessibility & Reach).
> **Goal**: koa becomes a proactive, autonomous assistant — schedules, composes, reviews, and
> summarises without being asked — while the codebase is hardened against the findings from the
> CP9 end-of-arc audit.
> **End-of-arc**: Full code/QA/security audit → CP11 backlog.

---

## CP10a — iOS Hardening & Bug Fixes

**Done when**: Keychain replaces UserDefaults for the bearer token; Siri "mark that done" works.

### iOS

- [ ] `ios/Koa/KeychainHelper.swift` (new) — `KeychainHelper` struct with
  `static func set(_ key: String, _ value: String)`,
  `static func get(_ key: String) -> String?`,
  `static func delete(_ key: String)`.
  Use `SecItemAdd` / `SecItemCopyMatching` / `SecItemDelete`.
  `kSecAttrAccessible = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
  AC: unit test (XCTest) writes and reads back a value; delete removes it.

- [ ] `ios/Koa/AppState.swift` — Replace `UserDefaults.standard.set/string(forKey: "bearerToken")`
  with `KeychainHelper.set/get("bearerToken")`. AC: token survives app restart; not visible in
  `UserDefaults` plist.

- [ ] `ios/Koa/KoaAPI.swift` (lines 76, 124) — Both static background helpers read bearer token
  directly from `UserDefaults`. Replace with `KeychainHelper.get("bearerToken") ?? ""`.
  AC: Siri shortcuts + notification reply still authenticate correctly.

- [ ] `ios/Koa/KoaIntents.swift` (line 48) — `MarkTaskDoneIntent.perform()` calls
  `api.updateTaskStatus(taskId:status:)` which does not exist. Replace with
  `api.updateTask(taskId: taskId, updates: ["status": "done"])`.
  AC: Siri "mark that done" shortcut completes without crash.

### Server / backend

- [ ] `src/channels/gmail.ts` — Change IMAP OAuth scope from `https://mail.google.com/` to
  `https://www.googleapis.com/auth/gmail.readonly` (principle of least privilege). AC: existing
  Gmail tests still pass; scope string updated in both the client and the IntegrationsPage
  connection-test flow.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] security review: Keychain migration complete, no HIGH/MEDIUM on new code
- [ ] ntfy: CP10a sealed

---

## CP10b — Server Refactor & Dead Code Cleanup

**Done when**: `src/server/index.ts` is split into 6 router files; unused exports removed;
`loadIntegrations()` calls don't hit disk on every request.

### Dead code removal

- [ ] `src/types/index.ts` — Remove unused `EngramSession` interface (lines 45–49) and dead
  `AgentState.sessionId?: string` field (line 97). Remove unused `ConfigModelTier` type and
  `CONFIG_MODEL_MAP` constant (lines 77–82). AC: tsc clean after removal; no test imports them.

- [ ] `src/db/index.ts` — Unexport `getProjectBySlug` (production code has no callers; only tests
  use it — move the export to a test helper if needed). Unexport `recordCheckpoint` or wire it
  into the `POST /api/checkpoint` route handler. AC: tsc clean; checkpoint table records inserts.

- [ ] `src/agent/select-agent.ts:30` — Remove `export` from `hasLifeSignals`; it is only called
  internally. AC: tsc clean.

- [ ] `src/channels/gmail.ts:186` — Either include `subject` in the extracted task title/body, or
  remove the extraction. The `void subject` suppression is dead weight. AC: tsc clean.

- [ ] `src/server/index.ts:1057–1105` — Replace the inline Whisper API call with a delegation to
  `transcribeAudio()` from `src/voice/whisper.ts`. Content-Type whitelist and size check remain
  server-side; the HTTP call moves to the shared function.
  AC: existing voice tests still pass; no duplicated Whisper logic.

### `loadIntegrations()` cache

- [ ] `src/integrations/store.ts` — Add module-level in-memory cache with 5-second TTL.
  `loadIntegrations()` returns the cached value if it is <5s old; otherwise reads disk and updates
  cache. `saveIntegration()` and `deleteIntegration()` invalidate the cache immediately.
  AC: add a test that calls `loadIntegrations()` three times in 100ms and asserts `fs.readFileSync`
  is called only once.

### Server router split

- [ ] `src/server/routes/` (new directory) — Extract the following from `src/server/index.ts`
  into separate Express Router files. Each file exports a `createRouter(deps)` factory. Mount
  routers in `src/server/index.ts` via `app.use()`.

  Route files:
  - `src/server/routes/chat.ts` — `/api/chat`, `/api/sse/chat`, `/api/checkpoint`
  - `src/server/routes/admin.ts` — `/api/admin/*` (config, memory, models, telegram, skills)
  - `src/server/routes/db.ts` — `/api/projects`, `/api/tasks`, `/api/decisions`, `/api/search`
  - `src/server/routes/push.ts` — `/api/push/*`
  - `src/server/routes/calendar.ts` — `/api/calendar/*`
  - `src/server/routes/webhooks.ts` — `/webhooks/slack`, `/webhooks/sms`

  AC: after split, `src/server/index.ts` is <200 lines (startup wiring only); all 410 tests pass;
  tsc clean; no behaviour change.

### Shared chat-stream helper

- [ ] `src/server/routes/chat.ts` — Extract `runChatStream(loop, message, res, opts?)` helper
  used by both `POST /api/chat` and `GET /api/sse/chat`. AC: no duplicate SSE setup code; both
  endpoints behave identically to current behaviour.

### Missing test coverage

The following source files have non-trivial logic but no tests:

- [ ] `src/__tests__/router.test.ts` — Test `routeResponse()`: quiet hours gate, batching
  (BATCH_THRESHOLD=3), exponential retry (mock `dispatchToChannel`), channel fallback to ntfy,
  critical bypass of quiet hours. AC: ≥6 new passing tests.

- [ ] `src/__tests__/chaining.test.ts` — Test `detectCompletionSignal()` and
  `buildPmFollowUpPrompt()` with fixture strings. AC: ≥4 new passing tests.

- [ ] `src/__tests__/calendar.test.ts` (extend) — Test `getConflicts()`, `getAvailableBlocks()`,
  `buildCalendarSummary()` with mock events. AC: ≥5 new passing tests.

- [ ] `src/__tests__/integrations.test.ts` — Test `loadIntegrations()` caching (fs.readFileSync
  call count), `saveIntegration()` invalidation, `maskSecrets()` masking logic.
  AC: ≥4 new passing tests.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass (expect 430+ after new tests)
- [ ] `src/server/index.ts` under 200 lines
- [ ] security review: no HIGH/MEDIUM regressions
- [ ] ntfy: CP10b sealed

---

## CP10c — Calendar Write & Email Compose

**Done when**: koa can create a Google Calendar event and send a Gmail email on the user's behalf.
Life Manager's response to "block two hours for deep work this afternoon" actually modifies the
calendar. "Reply to Ralph's last email and say I'll be there" actually sends.

### Calendar write

- [ ] `src/calendar/write.ts` (new) — `createEvent(event: CalendarEventDraft): Promise<string>`,
  `updateEvent(eventId: string, patch: Partial<CalendarEventDraft>): Promise<void>`,
  `deleteEvent(eventId: string): Promise<void>`. Uses stored OAuth token from
  `src/calendar/oauth.ts`. Returns event ID on create. AC: unit test mocks `fetch`; asserts
  correct `POST https://www.googleapis.com/calendar/v3/calendars/primary/events` payload.

- [ ] `src/agent/tools/calendar_write.ts` (new) — Tool definition: `create_calendar_event`,
  `update_calendar_event`, `delete_calendar_event`. Input schema validated (ISO date strings,
  duration minutes, summary required). AC: tool registered in registry; tool call with valid
  input calls `createEvent`; invalid input returns error string without API call.

- [ ] `src/calendar/oauth.ts` — Verify (and add if missing) `calendar` write scope
  (`https://www.googleapis.com/auth/calendar.events`) alongside existing read scope.
  AC: OAuth consent screen shows both scopes; existing sync still works.

### Email compose

- [ ] `src/channels/gmail-send.ts` (new) — `sendEmail(opts: { to: string; subject: string; body: string; replyToMessageId?: string }): Promise<string>`.
  Uses `gmail.users.messages.send` REST endpoint with RFC 2822 base64url encoding.
  OAuth token read from credentials. Returns Message-ID. AC: unit test mocks fetch; asserts
  correct base64url-encoded payload and `replyToMessageId` threading.

- [ ] `src/agent/tools/send_email.ts` (new) — Tool definition: `send_email`. Input: `to`,
  `subject`, `body`, optional `replyToMessageId`. Validates `to` is a well-formed email address.
  Returns `"Email sent to <to>"` on success, error string on failure.
  AC: tool registered; valid input calls `sendEmail`; invalid email address rejected without API
  call.

- [ ] `web/src/pages/IntegrationsPage.tsx` — Gmail card: display current granted scopes. Show
  warning if send scope not yet granted (requires re-auth). AC: scope list rendered; re-auth
  button triggers OAuth flow.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual test: Life Manager creates a calendar event via natural language
- [ ] Manual test: agent sends a reply email
- [ ] security review: OAuth scope changes, email send path validated
- [ ] ntfy: CP10c sealed

---

## CP10d — GitHub Integration

**Done when**: `/koa what PRs need my review?` returns open PRs with their CI status; `/koa open
an issue for the login bug` creates a GitHub issue.

### Server

- [ ] `src/integrations/github.ts` (new) — `getOpenPRs(owner, repo): Promise<PR[]>`,
  `getPRStatus(owner, repo, prNumber): Promise<CIStatus>`,
  `createIssue(owner, repo, title, body): Promise<string>`.
  Reads `GITHUB_TOKEN` from credentials. AC: unit tests mock `fetch`; assert correct GitHub API
  URLs and auth headers.

- [ ] `src/agent/tools/github.ts` (new) — Three tools: `list_prs` (open PRs awaiting review),
  `get_pr_status` (CI checks + approvals for a given PR), `create_github_issue`.
  Each reads `GITHUB_TOKEN` + `GITHUB_DEFAULT_REPO` (e.g. `owner/repo`) from credentials.
  Returns structured text summary. AC: ≥3 tool tests.

- [ ] `web/src/pages/IntegrationsPage.tsx` — GitHub card: token field + default repo field
  (replaces the current connection-test-only card). AC: token + repo save to credentials; card
  shows connected state.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual test: `koa` answers "what PRs do I have?" with real GitHub data
- [ ] security review: no token leakage in tool output
- [ ] ntfy: CP10d sealed

---

## CP10e — Morning Briefing & Standing Delegations

**Done when**: at 08:00 daily a push notification summarises the day; `/koa remind me every Monday
to review team PRs` persists and fires without a user prompt.

### Morning briefing

- [ ] `src/proactive/briefing.ts` (new) — `buildDailyBriefing(loop: AgentLoop): Promise<string>`.
  Assembles: today's calendar events, open high-priority tasks (due ≤48h), open GitHub PRs
  (if configured), current streaks, yesterday's completed tasks count. Formats as a ≤500-char
  push-friendly summary. AC: unit test with mock DB + mock calendar; asserts all sections present.

- [ ] `src/server/index.ts` (or `src/server/routes/admin.ts` after CP10b) — Cron job on server
  startup: `setInterval` at 08:00 local time, calls `buildDailyBriefing()` → `routeResponse('briefing', ...)`.
  Configurable time via Settings. AC: integration test mocks system time to 08:00; asserts
  `routeResponse` called with briefing text.

- [ ] `web/src/pages/SettingsPage.tsx` — Add "Morning Briefing" section: enabled toggle + time
  picker (HH:MM). Saves to config. AC: toggle persists; time picker updates config.

### Standing delegations

- [ ] `src/db/index.ts` — New `delegations` table (migration v7):
  `id, pattern TEXT, action TEXT, schedule TEXT (cron), last_run TEXT, enabled INTEGER`.
  CRUD: `createDelegation`, `listDelegations`, `updateDelegation`, `deleteDelegation`.
  AC: migration applies cleanly; CRUD ops tested.

- [ ] `src/proactive/delegations.ts` (new) — `runDueDelegations(loop: AgentLoop): Promise<void>`.
  Loads enabled delegations; checks if `last_run` + `schedule` interval means now is due;
  calls `loop.turn(action)` for each due delegation; updates `last_run`. Uses `cronstrue` or
  simple interval parsing (daily/weekly/monthly). AC: unit test with fixture delegations; asserts
  correct turns fired.

- [ ] `src/server/index.ts` — 5-minute `setInterval` on startup calls `runDueDelegations()`.
  AC: test asserts delegations with past `last_run` trigger on the next interval.

- [ ] REST: `GET/POST /api/delegations`, `PUT /api/delegations/:id`, `DELETE /api/delegations/:id`.
  AC: CRUD endpoints tested.

- [ ] `web/src/pages/` — New `DelegationsPage.tsx`: list of standing delegations with
  pattern/action/schedule/enabled columns. Add/edit modal. Add to nav rail.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual test: briefing fires at correct time with real data
- [ ] Manual test: create a delegation → wait for interval → confirm it fires
- [ ] security review: cron injection via schedule field, action field prompt injection risk
- [ ] ntfy: CP10e sealed

---

## CP10f — iOS Search & Voice Round-Trip

**Done when**: Search from iOS shows results across all projects; Koa's voice response is spoken
aloud on iOS (not just on macOS).

### iOS Search

- [ ] `ios/Koa/SearchView.swift` (new) — Full-text search screen. Text field calls
  `GET /api/search?q=<query>`. Results shown in list (task title + project + status).
  Tap navigates to `TaskDetailView`. AC: compiles; search input debounced 300ms; results render.

- [ ] `ios/Koa/KoaAPI.swift` — Add `static func search(query: String) async throws -> [KoaTask]`.
  Calls `/api/search`. AC: method compiles; decodes response correctly.

- [ ] `ios/Koa/ContentView.swift` — Add Search tab to TabView. AC: tab visible; tapping navigates
  to `SearchView`.

### iOS Voice TTS (server-side audio)

- [ ] `src/server/index.ts` (or routes/chat.ts after CP10b) — `GET /api/voice/synthesize?text=...`
  (bearer-auth). Calls macOS `say -v Samantha --data-format=aiff -o -` (stdout), pipes audio
  bytes in response with `Content-Type: audio/aiff`. 500-char text limit enforced.
  Same markdown-stripping as `src/voice/tts.ts`. AC: endpoint returns binary audio;
  missing text returns 400.

- [ ] `ios/Koa/KoaAPI.swift` — Add `static func synthesizeAudio(text: String) async throws -> Data`.
  GETs `/api/voice/synthesize?text=<encoded>`. AC: method compiles.

- [ ] `ios/Koa/ChatView.swift` — After receiving the `done` SSE event, call
  `KoaAPI.synthesizeAudio(text: lastResponse)` and play via `AVAudioPlayer` instead of (or
  alongside) the existing `AVSpeechSynthesizer`. Fallback to `AVSpeechSynthesizer` if the endpoint
  returns non-200. AC: audio plays on device; fallback triggers correctly.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual test: search from iOS finds tasks across projects
- [ ] Manual test: Koa's voice response is heard on iOS device
- [ ] security review: synthesize endpoint text length enforced, no path traversal
- [ ] ntfy: CP10f sealed

---

## End-of-Arc Audit (after CP10f checkpoint)

Run in sequence:
1. `npx tsc --noEmit` — zero errors
2. `npm test` — zero failures
3. `security-review` skill on all CP10 changes
4. Manual code quality pass: dead code, over-engineering, missing tests
5. Generate new TASKS.md from findings

---

## Deferred Backlog

> Items below have been promoted into CP11/CP12 or the pre-CP11 housekeeping punch list.
> watchOS → CP11d. Multi-Agent Chaining → CP11b. tvOS → Product Radar.

### tvOS Dashboard (Phase C)
> Low priority. After watchOS (CP11d).
- Full-screen ambient display (hot files, session status, cost chart)
- Voice query via Siri Remote mic
- APNs notification banners (no reply needed)

---

## Pre-CP11 Housekeeping Punch List

> Fast, targeted fixes from the CP10 end-of-arc audit. Run these **before** starting CP11.
> None require a full pipeline; each is a surgical change. tsc + tests must be green after each.

### Security / Correctness (do first)

- [ ] **H1 — Non-atomic integration writes** (`src/integrations/store.ts`)
  `saveIntegration()` reads-then-writes the integrations file without atomicity. Under concurrent
  webhook handlers the second write silently wins, discarding the first. Fix: write to
  `.integrations.tmp.json` then `fs.renameSync` (atomic on POSIX), matching the pattern already
  in `src/skills/store.ts`. AC: existing integration tests pass; no tmp file left on success.

- [ ] **H3 — No per-tool timeout** (`src/agent/loop.ts` tool dispatch block)
  A hanging `web_fetch` or slow custom skill blocks the entire turn indefinitely. Add
  `AbortSignal.timeout(config.toolTimeoutMs ?? 30_000)` to `ToolRegistry.execute()`.
  `web_fetch.ts` and `web_search.ts` already accept `signal`; wire it through.
  AC: unit test asserts a tool that never resolves is cancelled after 30 s.

- [ ] **H4 — Credentials stored as a plaintext flat file** (`src/config/credentials.ts`)
  `~/.koa/credentials` holds `ANTHROPIC_API_KEY`, OAuth refresh tokens, and Twilio credentials.
  The file is written with `mode: 0o600` but this is not enforced on subsequent writes if `umask`
  changes. Short-term fix: add `fs.chmodSync(path, 0o600)` after every write. Long-term
  (CP12+): macOS Keychain via `keytar`. AC: `ls -la ~/.koa/credentials` shows `-rw-------`.

- [ ] **M5 — FTS5 query not sanitised** (`src/db/index.ts:searchTasks()`)
  A bare `"` or FTS5 operator from the user throws a `sqlite3_prepare` error that surfaces as a
  500. Add an `escapeFts(q: string): string` helper that strips `"'*^()` before passing to FTS5.
  Apply to both `searchTasks()` and `searchDecisions()`. AC: `searchTasks('"')` returns `[]` not
  an exception; new test asserts this.

- [ ] **M6 — `actual_hours` not in task update whitelist** (`src/server/index.ts`)
  `PUT /api/tasks/:id` drops `actual_hours` from the request body — the web UI cannot set it.
  Add `actual_hours` to the allowed update fields in the handler. AC: `PUT /api/tasks/1` with
  `{ actual_hours: 2.5 }` returns the updated task; existing task tests still pass.

### Performance

- [ ] **M1 — `loadCustomSkills()` reads disk on every session init** (`src/skills/store.ts`)
  Same N-read problem as `loadIntegrations()` (fixed in CP10b). Apply identical 5-second
  in-memory TTL cache + invalidation on `saveCustomSkill()` / `deleteCustomSkill()`.
  AC: `loadCustomSkills()` called 3× in 100ms → `fs.readFileSync` called once.

- [ ] **M3 — `loadRules()` / `loadQuietHours()` read disk on every `routeResponse()`** (`src/notifications/store.ts`)
  Both are called synchronously in the notification hot path. Add a 30-second module-level cache
  with invalidation on `saveRules()` / `saveQuietHours()`. AC: test asserts single disk read for
  3 calls within 30 s window.

### Type Safety

- [ ] **`any` casts in fetch error handlers** (`src/agent/tools/web_fetch.ts:49`, `web_search.ts:64`)
  Both `catch (e: any)` blocks access `e.name` and `e.message`. Replace with `unknown` +
  type narrowing (`e instanceof Error`). AC: tsc strict clean; no `any` in these files.

### Dead API Surface

- [ ] **Unexport internal helpers in `select-agent.ts`** (`src/agent/select-agent.ts`)
  `isCodeQuery()`, `hasBacklogSignals()`, `hasLifeSignals()` are exported but only called
  internally by `selectAgent()`. Remove `export` from all three. AC: tsc clean; no external
  callers.

- [ ] **Consolidate `HAIKU_MODEL` constant** (`src/config/index.ts`, `src/agent/router.ts`)
  `HAIKU_MODEL` in `config/index.ts` duplicates the `MODELS.haiku` constant in `router.ts` and
  can diverge. Remove `HAIKU_MODEL` from `config/index.ts`; import `MODELS.haiku` from router
  everywhere. AC: tsc clean; no duplicate model string literals.

### Test Coverage

- [ ] **`src/agent/tools/bash.ts` — no test** (HIGH risk — shell execution)
  Add `src/__tests__/bash_tool.test.ts`: test that allowed commands execute; test that blocked
  commands are rejected; test that stdout truncation fires at `maxToolOutputChars`. Mock
  `child_process.exec`. AC: ≥5 new tests.

- [ ] **`src/voice/recorder.ts` — no test**
  Add tests for `AudioRecorder.isAvailable()` (mock `spawnSync`) and that `stop()` terminates
  the sox process. AC: ≥3 new tests; no real sox process spawned.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test (expect 420+ after new tests)
- [ ] All HIGH/MEDIUM items above resolved
- [ ] ntfy: pre-CP11 housekeeping sealed

---

## v6 CP11 — Voice, Intelligence & Platform Reach

> **Position**: After CP10 complete.
> **Theme**: Multi-voice TTS, true multi-agent chaining, conversation persistence, watchOS Phase B.
> **Done-when**: ElevenLabs TTS is selectable alongside macOS `say`; code→PM hand-off fires
> automatically on completion signals; every chat session is persisted to SQLite and exportable;
> a watchOS companion app compiles and receives push replies.

---

### CP11a — Multi-Voice TTS (ElevenLabs + macOS `say` abstraction)

**Done when**: `koa` responds in an ElevenLabs voice when `ELEVENLABS_API_KEY` is set; macOS
`say` still works as the zero-dependency default.

- [ ] `src/voice/tts.ts` — Refactor from a single `speak()` function into a provider dispatch.
  Define `TtsProvider = 'macos' | 'elevenlabs'`. Extract current `say`-based logic into a
  `macosSpeak(text)` helper. Export `speak(text, config?)` that dispatches based on configured
  provider. `isTtsAvailable()` returns `true` when either provider is configured.
  AC: existing voice tests still pass; `speak()` signature unchanged.

- [ ] `src/voice/elevenlabs.ts` (new) — `synthesizeElevenLabs(text: string, voiceId: string,
  apiKey: string): Promise<Buffer>`. Calls
  `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream` with `model_id:
  eleven_turbo_v2_5`. Returns MP3 buffer. `listVoices(apiKey): Promise<{id: string; name:
  string}[]>` calls `/v1/voices`. AC: unit tests mock `fetch`; `synthesize` asserts correct
  headers and voice ID; `listVoices` returns parsed list.

- [ ] `src/server/routes/voice.ts` (new, or extend `routes/chat.ts` after CP10b) —
  `GET /api/voice/synthesize?text=...` (bearer-auth). Routes to the configured provider.
  ElevenLabs: reads `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` from credentials; returns
  `audio/mpeg`. macOS: pipes `say` stdout AIFF. 500-char limit; missing key returns 503.
  `GET /api/voice/voices` — proxies `listVoices()` when ElevenLabs key is present.
  AC: correct `Content-Type` per provider; missing key → 503.

- [ ] `web/src/pages/SettingsPage.tsx` — "Voice" section: provider radio (macOS / ElevenLabs),
  ElevenLabs API key field, voice picker (loaded from `GET /api/voice/voices`).
  Saves `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` to credentials.
  AC: macOS selection hides ElevenLabs fields; voice picker loads and saves.

- [ ] `ios/Koa/ChatView.swift` — `speakResponse()` already calls `/api/voice/synthesize`
  (from CP10f). Verify ElevenLabs audio plays when server is configured; `AVSpeechSynthesizer`
  fallback triggers on non-200. AC: no iOS code change needed if CP10f synthesize endpoint is
  wired — verify only.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual: ElevenLabs voice plays in web console + CLI
- [ ] Manual: macOS `say` fallback works with no ElevenLabs key
- [ ] security review: no API key in logs or SSE events
- [ ] ntfy: CP11a sealed

---

### CP11b — True Multi-Agent Chaining (Code → PM auto-handoff)

**Done when**: After a code-assistant response containing clear completion signals, the PM agent
automatically updates task status without a second prompt.

- [ ] `src/agent/chaining.ts` — Extend `detectCompletionSignal()` to return
  `{ detected: boolean; confidence: number }`. Add `shouldAutoChain(result: TurnResult): boolean`
  — returns `true` when `agentName === 'code-assistant'` AND confidence > 0.7. Add negative
  lookahead: if response contains "but" or "however" within 50 chars of a keyword, lower
  confidence by 0.3. Export both. AC: unit tests for each branch.

- [ ] `src/agent/loop.ts` — In `turn()`, after code-assistant response resolves: if
  `shouldAutoChain()` && `config.autoChaining`, fire a second `turn()` with PM agent spec
  (bypass `selectAgent`), using `buildPmFollowUpPrompt(result.content)`. Surface as
  `chainedResult?: TurnResult` in `TurnResult`. Emit `event: 'chain_start'` on the same SSE
  stream before the chained turn. PM turn never triggers another chain (guard: depth > 0).
  AC: no infinite recursion; PM follow-up fires only for code-assistant turns.

- [ ] `src/config/index.ts` — Add `autoChaining: boolean` (default `false`) to `KoaConfig`.
  AC: tsc clean; persists to `config.json`.

- [ ] `web/src/pages/SettingsPage.tsx` — "Agent Chaining" toggle in Advanced section. Label:
  "Auto-update tasks after code completions". AC: toggle reads/writes `autoChaining`.

- [ ] `src/__tests__/chaining.test.ts` — Add: `shouldAutoChain()` with code-assistant vs. other
  agents; loop fires chained PM turn when `autoChaining=true`; chaining does not recurse;
  negative lookahead lowers confidence. AC: ≥6 new passing tests.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual: "implemented and all tests pass" response triggers PM follow-up
- [ ] Manual: `autoChaining=false` produces no chain
- [ ] security review: chain depth guard, prompt injection via completion signal
- [ ] ntfy: CP11b sealed

---

### CP11c — Conversation Persistence & Export

**Done when**: Every chat session is persisted to SQLite automatically; any session is
exportable as JSON or Markdown.

- [ ] `src/db/migrations.ts` — Migration v7: `conversations` table (`id, title, started_at,
  ended_at, turn_count, project_id NULLABLE`) + `conversation_turns` table (`id, conversation_id
  FK, role, content, tool_uses TEXT DEFAULT '[]', agent_name, model, cost_usd, created_at`).
  AC: migration applies cleanly; no existing migrations break.

- [ ] `src/db/index.ts` — CRUD: `createConversation`, `closeConversation(id, turnCount)`,
  `addConversationTurn`, `listConversations(limit?)`, `getConversation(id)`,
  `getConversationTurns(id)`, `deleteConversationsBefore(date: string)`.
  AC: all functions tested; FK constraints respected.

- [ ] `src/agent/loop.ts` — `initialize()` calls `createConversation()` → stores `conversationId`.
  Each `turn()` calls `addConversationTurn()` for user message and assistant response (tool uses
  serialised as JSON). `finalize()` calls `closeConversation()`.
  AC: every session creates exactly one `conversations` row; every turn two rows.

- [ ] `src/server/routes/` — Routes: `GET /api/conversations` (last 50), `GET
  /api/conversations/:id`, `GET /api/conversations/:id/turns`, `GET
  /api/conversations/:id/export?format=json|markdown`, `DELETE
  /api/conversations?before=YYYY-MM-DD`. Markdown export: formatted chat log with timestamps,
  tool call annotations, model used. AC: export tested; Markdown is human-readable.

- [ ] `web/src/pages/ActivityPage.tsx` — Add "Conversations" tab: list with title, date, turn
  count, cost. Click → read-only replay view. "Export" downloads JSON or Markdown.
  AC: renders without error; export download works.

### Checkpoint gate
- [ ] tsc clean
- [ ] npm test all pass (migration v7 tested)
- [ ] Manual: CLI session shows up in Conversations list in web console
- [ ] Manual: Markdown export is readable and complete
- [ ] security review: export endpoint scoped to authenticated user
- [ ] ntfy: CP11c sealed

---

### CP11d — watchOS Companion (Phase B)

**Done when**: `xcodebuild -scheme KoaWatch` succeeds; glance shows live data; quick-prompt
tap returns a Koa response on wrist.

- [ ] `ios/KoaWatch/` (new Xcode target, watchOS 10+) — Swift Package shared between iOS +
  watchOS. `WatchApp.swift`, `WatchContentView.swift` (Glance / Tasks / Prompts tabs).
  `WKExtensionDelegate` for background APNs. AC: target compiles on watchOS Simulator.

- [ ] `ios/KoaWatch/GlanceView.swift` — Complication + glance: last Koa message (≤80 chars),
  open task count, today's calendar event count, session cost today. Reads from shared App Group
  `UserDefaults` populated by iOS app. AC: data renders on Watch face; updates ≤15 min after iOS
  sync.

- [ ] `ios/KoaWatch/QuickPromptsView.swift` — 5 configurable quick-prompt buttons (strings in
  App Group `UserDefaults`). Tap → `POST /api/chat?format=brief`. Response in
  `WKAlertController`. AC: 5 buttons configurable from iOS Settings; response renders.

- [ ] `ios/KoaWatch/WatchDictationView.swift` — `WKInterfaceTextField` dictation. On confirm,
  sends to `POST /api/chat?format=brief`. Response shown ≤200 chars.
  AC: dictation captures speech; response renders.

- [ ] `ios/Koa/SettingsView.swift` — "Watch" section: configure 5 quick-prompt labels. Writes to
  App Group `UserDefaults`. AC: prompts persist; watchOS target reads them.

### Checkpoint gate
- [ ] `xcodebuild -scheme KoaWatch -destination 'platform=watchOS Simulator'` succeeds
- [ ] Glance shows live data within 15 minutes
- [ ] Quick prompt returns Koa response within 10 s on WiFi
- [ ] tsc clean; npm test all pass
- [ ] security review: App Group data exposure, bearer token not in shared defaults
- [ ] ntfy: CP11d sealed

---

### CP11 End-of-Arc Audit
1. `npx tsc --noEmit` — zero errors
2. `npm test` — zero failures
3. `security-review` skill on all CP11 changes
4. Generate new TASKS.md from findings

---

## v6 CP12 — Extensibility, Intelligence & Self-Hosted Reach

> **Position**: After CP11 complete.
> **Theme**: Plugin SDK, semantic context management, optional local LLM (Ollama), conversation graph.
> **Done-when**: A third-party tool is addable via a JSON manifest; context compaction is cluster-aware
> and measurably cheaper; `koa --provider=ollama` works against a local Ollama instance.

---

### CP12a — Plugin / Tool Extensibility SDK

**Done when**: Dropping a valid `~/.koa/plugins/my-plugin.json` makes the declared tools
available in the next koa session; invalid manifests are skipped with a warning.

- [ ] `src/plugins/loader.ts` (new) — `loadPlugins(): PluginDef[]`. Scans `~/.koa/plugins/*.json`.
  `PluginDef`: `{ name, version, description, tools: ToolManifest[] }`. `ToolManifest`:
  `{ name, description, inputSchema, transport: 'bash' | 'http' | 'mcp', config }`. Validates
  with Zod; skips malformed files with a warning. AC: unit tests with fixture manifests; invalid
  JSON skipped; valid manifests load.

- [ ] `src/plugins/bridge.ts` (new) — `createPluginTool(manifest: ToolManifest): Tool`. `bash`
  and `http` transports delegate to the existing custom-skill pattern. `mcp` transport establishes
  stdio/SSE MCP client (`@modelcontextprotocol/sdk`) and proxies calls. AC: bash + http tested;
  mcp stubs with clear error when server unavailable.

- [ ] `src/agent/tools/registry.ts` — Add `registerMany(tools: Tool[]): void`. Tag each tool
  with `source: 'builtin' | 'custom-skill' | 'plugin'`. AC: tsc clean; existing tests pass.

- [ ] `src/cli/index.ts` — After loading custom skills, call `loadPlugins()` → `createPluginTool()`
  → `registry.register()`. AC: plugins in `~/.koa/plugins/` available without restart.

- [ ] `web/src/pages/SkillsPage.tsx` — Add "Plugins" tab: lists loaded plugins with name, version,
  tool count, source path. Read-only (file-managed). AC: renders; correct tool count shown.

### Checkpoint gate
- [ ] tsc clean; npm test all pass
- [ ] Manual: custom plugin tool available in `koa` after dropping manifest
- [ ] Invalid manifest → warning logged, no crash
- [ ] security review: manifest path traversal, bash transport injection
- [ ] ntfy: CP12a sealed

---

### CP12b — Semantic Context Window Compaction

**Done when**: Cluster-based compaction produces summaries measurably shorter than the current
flat-window approach; context pressure is visible in the web console.

- [ ] `src/agent/loop.ts` — Replace `compressOldMessages()` with `semanticCompact()`:
  (a) group messages into tool-use clusters (user msg + tool calls + results = one cluster),
  (b) summarise each cluster with Haiku at ≤300 tokens,
  (c) assemble summaries chronologically separated by `---`,
  (d) preserve last 4 clusters verbatim.
  AC: unit test with 20-message fixture asserts cluster boundaries preserved and summary is
  ≤40% of original char count.

- [ ] `src/agent/loop.ts` — Add `contextStats(): { totalMessages: number; estimatedTokens: number;
  clusterCount: number; lastCompactionAt: string | null }`. Include in `TurnResult.contextStats`.
  AC: non-zero values after a turn; tests assert.

- [ ] `src/server/routes/chat.ts` (after CP10b) — Include `contextStats` in `usage` SSE event.
  AC: web console receives stats payload.

- [ ] `web/src/components/TopNav.tsx` — Subtle context pressure indicator (arc or % badge beside
  model badge): `estimatedTokens / 200000`. Turns amber >50%, red >70%.
  AC: renders; updates after each turn; no layout shift.

- [ ] `src/__tests__/loop_compact.test.ts` — Add: cluster grouping logic; last 4 clusters never
  summarised; `contextStats()` correct values after compaction. AC: ≥5 new tests.

### Checkpoint gate
- [ ] tsc clean; npm test all pass
- [ ] Manual: 30-turn session compacts without losing recent context
- [ ] Context pressure badge visible in web console
- [ ] security review: no prompt injection via cluster summary boundaries
- [ ] ntfy: CP12b sealed

---

### CP12c — Self-Hosted LLM Provider (Ollama)

**Done when**: `koa --provider=ollama` produces a response from a locally running Ollama
instance; switching back to Anthropic requires no config file surgery.

- [ ] `src/agent/providers/anthropic.ts` (new) — Extract `client.messages.create()` from
  `AgentLoop` into `AnthropicProvider` implementing `LlmProvider` interface:
  `{ create(params): Promise<StreamableResponse>; stream(params): AsyncIterable<StreamEvent> }`.
  Pure refactor — no behaviour change. AC: tsc clean; all existing loop tests pass.

- [ ] `src/agent/providers/ollama.ts` (new) — `OllamaProvider` implementing `LlmProvider`. Calls
  `http://localhost:11434/api/chat` (OpenAI-compatible). Maps Anthropic `MessageParam[]` to
  OpenAI `messages[]`; maps response back. Tool use best-effort; logs warning when model doesn't
  support function calling. Strips Anthropic cache-control blocks.
  AC: unit tests mock Ollama HTTP; basic chat without tools works; tool-use degrades gracefully.

- [ ] `src/config/index.ts` — Add `provider: 'anthropic' | 'ollama'` and `ollamaModel: string`
  (default `'llama3.2'`) to `KoaConfig`. AC: tsc clean; persists to `config.json`.

- [ ] `src/agent/loop.ts` — Instantiate `AnthropicProvider` or `OllamaProvider` based on
  `config.provider`. Replace `client.messages.create()` call sites with `provider.create()`.
  AC: `koa --provider=ollama` starts; basic turn round-trip works.

- [ ] `web/src/pages/SettingsPage.tsx` — "LLM Provider" section: radio (Anthropic / Ollama).
  Ollama: model name field + "Test connection" button (`GET /api/admin/ollama/models` →
  proxies `http://localhost:11434/api/tags`). AC: switching saves to config; test button shows
  available local models.

### Checkpoint gate
- [ ] tsc clean; npm test all pass
- [ ] Manual: `koa --provider=ollama` responds from local Ollama
- [ ] Manual: Ollama unavailable → clear error, not a crash
- [ ] security review: SSRF risk on Ollama URL, no proxy to arbitrary hosts
- [ ] ntfy: CP12c sealed

---

### CP12d — Conversation Intelligence (Auto-Title & Cross-Session Search)

**Done when**: Every closed conversation has an auto-generated title; cross-session FTS search
returns turn excerpts across all past sessions.

- [ ] `src/db/migrations.ts` — Migration v8: FTS5 virtual table on `conversation_turns.content`.
  AC: migration tested; FTS5 table populated on first query.

- [ ] `src/db/index.ts` — `updateConversationTitle(id, title)`. `searchConversations(query):
  Array<{ conversationId: string; turnId: string; excerpt: string }>`. Sanitise query with
  `escapeFts()` (from pre-CP11 punch list). AC: both functions tested; empty query returns `[]`.

- [ ] `src/agent/loop.ts` — In `finalize()`, after Engram session persist: call Haiku with first
  3 user messages to generate ≤60-char title; call `updateConversationTitle()`.
  Cost: ~50 input tokens. AC: `updateConversationTitle` called after `finalize()`; title ≤60 chars.

- [ ] `src/server/routes/` — `GET /api/conversations/search?q=<query>` — returns turn excerpts
  with conversation metadata. 400 for empty query. AC: tested; ranked results.

- [ ] `web/src/pages/SearchPage.tsx` — "Conversations" tab alongside task results. Turn excerpts
  with "Open conversation" link (navigates to replay view from CP11c). AC: renders; click
  navigates correctly.

### Checkpoint gate
- [ ] tsc clean; npm test all pass (migration v8 tested)
- [ ] Manual: closed session appears with auto-title in Conversations list
- [ ] Manual: `GET /api/conversations/search?q=oauth` returns relevant turns
- [ ] security review: FTS query sanitisation applied
- [ ] ntfy: CP12d sealed

---

### CP12e — Sandboxed Code Execution

**Done when**: The agent can execute code snippets in an isolated sandbox; Docker backend works
when available; local backend (child_process) is the zero-dependency fallback.

- [ ] `src/sandbox/runner.ts` (new) — `SandboxRunner` interface:
  `{ exec(code: string, language: string, opts?: ExecOpts): Promise<ExecResult> }`.
  `ExecResult`: `{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }`.
  `ExecOpts`: `{ timeoutMs?: number; memoryMb?: number; env?: Record<string, string> }`.
  AC: interface exported; tsc clean.

- [ ] `src/sandbox/local.ts` (new) — `LocalRunner` implementing `SandboxRunner`. Wraps
  `child_process.spawn` with `AbortSignal.timeout(opts.timeoutMs ?? 10_000)`. Writes code to a
  temp file (`os.tmpdir()`); runs the appropriate interpreter (`node`, `python3`, `bash`).
  Captures stdout/stderr up to 50 KB; truncates with `[truncated]` marker. Cleans temp file on
  exit. Supported languages: `javascript`, `python`, `bash`.
  AC: unit tests mock `spawn`; timeout fires; truncation enforced; temp file cleaned.

- [ ] `src/sandbox/docker.ts` (new) — `DockerRunner` implementing `SandboxRunner`. Calls
  `docker run --rm --network=none --memory=<memoryMb>m --cpus=0.5 --read-only
  -v <tmpdir>:/code:ro <image> <interpreter> /code/<file>`. Image per language:
  `node:22-alpine`, `python:3.12-alpine`, `bash:5`. Falls back to `LocalRunner` when Docker
  daemon is unreachable. AC: unit test mocks `spawn`; correct flags asserted; fallback tested.

- [ ] `src/sandbox/index.ts` (new) — `createRunner(config: KoaConfig): SandboxRunner`. Returns
  `DockerRunner` when `config.sandboxBackend === 'docker'` and Docker is reachable; otherwise
  `LocalRunner`. AC: returns correct runner type based on config.

- [ ] `src/agent/tools/execute_code.ts` (new) — Tool definition: `execute_code`. Input:
  `language: 'javascript' | 'python' | 'bash'`, `code: string`. Calls `runner.exec()`. Returns
  formatted string: stdout/stderr + exit code. Rejects blank code and unsupported languages
  before exec. AC: tool registered in registry; invalid input returns error string without exec;
  ≥4 tests.

- [ ] `src/config/index.ts` — Add `sandboxBackend: 'local' | 'docker'` (default `'local'`) and
  `sandboxTimeoutMs: number` (default `10000`) to `KoaConfig`. AC: tsc clean; persists.

- [ ] `web/src/pages/SettingsPage.tsx` — "Code Execution" section: backend radio (Local /
  Docker), timeout slider (5–60 s). Shows Docker availability status (green/red dot via
  `GET /api/admin/sandbox/status`). AC: saves to config; status dot accurate.

### Checkpoint gate
- [ ] tsc clean; npm test all pass
- [ ] Manual: `koa "write and run a python fizzbuzz"` executes and returns output
- [ ] Manual: Docker backend runs in isolated container with `--network=none`
- [ ] Manual: 10-second timeout kills a hanging script
- [ ] security review: temp file cleanup, no code injection via language param, Docker flag audit
- [ ] ntfy: CP12e sealed

---

### CP12f — Browser Automation (Playwright)

**Done when**: The agent can navigate to a URL, extract text, fill forms, and take screenshots
using a headless Playwright browser; SSRF guard prevents access to private network ranges.

- [ ] `src/browser/client.ts` (new) — `BrowserClient` singleton. Lazy-initialises a Playwright
  `chromium` browser (persistent context, `headless: true`). `getPage(): Promise<Page>` returns
  or creates a single reusable `Page`. `close(): Promise<void>` tears down. Graceful shutdown
  registered in `src/server/shutdown.ts`. AC: single browser instance per process; closes cleanly.

- [ ] `src/browser/actions.ts` (new) — Action helpers wrapping Playwright `Page`:
  - `navigate(url: string): Promise<string>` — validates URL against `ssrfGuard()` (from
    `src/utils/ssrf.ts`), navigates, returns page title.
  - `extractText(selector?: string): Promise<string>` — returns `innerText` of selector or
    `document.body` if omitted; truncated to 20 KB.
  - `screenshot(): Promise<Buffer>` — full-page PNG ≤2 MB; throws if over limit.
  - `fillForm(fields: Record<string, string>): Promise<void>` — `locator(key).fill(value)` for
    each entry.
  - `click(selector: string): Promise<void>` — `locator(selector).click()`.
  All helpers share a 15-second per-action timeout. AC: unit tests mock Playwright; SSRF guard
  tested; truncation enforced.

- [ ] `src/agent/tools/browser.ts` (new) — Five tool definitions sharing one `BrowserClient`:
  - `browser_navigate` — input: `url`. Returns page title.
  - `browser_extract` — input: optional `selector`. Returns visible text.
  - `browser_screenshot` — no input. Returns base64 PNG (Claude vision-compatible).
  - `browser_fill` — input: `fields` object.
  - `browser_click` — input: `selector`.
  All guarded by `ssrfGuard()`; private IPs rejected before navigation.
  AC: all five tools registered; ≥5 tests (SSRF rejection, text truncation, form fill).

- [ ] `package.json` — Add `playwright` as an optional dependency.
  `src/browser/client.ts` wraps the import in a try/catch; if Playwright is not installed the
  tools register but return `"Browser tools unavailable: run npm install playwright"`.
  AC: server starts cleanly without Playwright installed; tools return helpful error string.

- [ ] `web/src/pages/SettingsPage.tsx` — "Browser Automation" section: enable toggle.
  Status indicator: green when `chromium` executable found, red when not. "Install Playwright"
  button triggers `POST /api/admin/browser/install` (runs `npx playwright install chromium`).
  AC: toggle persists; status accurate; install button triggers install route.

### Checkpoint gate
- [ ] tsc clean; npm test all pass
- [ ] Manual: `koa "go to example.com and tell me what you see"` returns page content
- [ ] Manual: `koa "take a screenshot of the Koa web console"` returns readable PNG
- [ ] Manual: private-IP URL (192.168.x.x) blocked by SSRF guard
- [ ] security review: SSRF guard coverage, form fill injection risk, screenshot size limit
- [ ] ntfy: CP12f sealed

---

### CP12 End-of-Arc Audit
1. `npx tsc --noEmit` — zero errors
2. `npm test` — zero failures
3. `security-review` skill on all CP12 changes
4. Manual code quality pass: dead code, over-engineering, missing tests
5. Generate new TASKS.md from findings

---

## Product Radar (CP13+)

Items worth watching — not yet specced, revisit after CP12.

- **Ambient Dashboard (tvOS / macOS screensaver)** — full-screen read-only display of today's
  task board, calendar, and cost metrics. Applicable to tvOS Phase C or as a macOS screensaver.
- **Structured tool output via JSON schema** — `output_schema` field in `ToolManifest` auto-validates
  plugin results, reducing hallucination from malformed tool responses.
- **Per-project spending budgets** — `budget_usd` on `projects` table; check before each turn;
  block runaway agent loops on lower-priority projects.
- **Webhook-triggered delegations** — extend CP10e `delegations` with `trigger_type: 'webhook'`
  and a generated secret URL, letting GitHub CI, Zapier, or IFTTT trigger Koa actions.
- **Agent memory diff panel** — "What Koa remembered" section in web console showing the delta
  to project markdown / Engram after each session, building trust in the memory system.
