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

### CP12g — Homelab Deployment Scaffolding

**Done when**: A fresh Proxmox LXC can be bootstrapped with one script; a dev-machine push-and-restart
deploys a new build in under 60 seconds; all deployment config lives in `deploy/` and `scripts/`.

No source code changes. Pure infra files.

- [ ] `Dockerfile` — Multi-stage build. Stage 1: `node:20-slim`, install deps, compile TS + build
  web. Stage 2: copy `dist/`, `web/dist/`, `node_modules/` (prod only). `ENV KOA_HOME=/data`.
  `EXPOSE 3000`. AC: `docker build .` produces a working image; `docker run -e ANTHROPIC_API_KEY=x`
  starts the server.

- [ ] `deploy/koa.service` — systemd unit. Runs as unprivileged `koa` user. `ExecStart=node
  /opt/koa/dist/cli/index.js web`. `EnvironmentFile=/etc/koa/env`. `KOA_HOME=/var/lib/koa`.
  `Restart=on-failure`. `RestartSec=5`. AC: `systemctl enable koa` survives reboot.

- [ ] `deploy/Caddyfile` — Template. `{$KOA_DOMAIN}` proxies to `localhost:3000`. Auto-TLS via
  ACME or Tailscale cert. Header forwarding for bearer auth. AC: `caddy validate` passes.

- [ ] `deploy/bootstrap.sh` — One-shot LXC setup. Installs Node.js 20 LTS (via NodeSource), Caddy
  (via apt), creates `koa` system user, mkdir `/var/lib/koa` + `/etc/koa` with correct permissions,
  copies `deploy/koa.service` to `/etc/systemd/system/`, enables and starts service. Idempotent
  (safe to re-run). AC: runs clean on a fresh Debian 12 LXC; `systemctl status koa` is active.

- [ ] `scripts/deploy.sh` — Push-and-restart. `rsync -az dist/ web/dist/ node_modules/ $KOA_HOST:/opt/koa/`.
  SSH `systemctl restart koa`. Reads target from `KOA_HOST` env var. Aborts if `npm run build`
  fails. AC: full deploy cycle completes in <60 s on LAN.

- [ ] `.env.example` — Documents every env/credential var Koa reads: `ANTHROPIC_API_KEY`,
  `KOA_WEB_TOKEN`, `KOA_HOME`, `KOA_MODEL`, `KOA_TTS_PROVIDER`, `ELEVENLABS_API_KEY`,
  `SPIDERBRAIN_BRAIN`, plus optional channel vars (`TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, etc.).
  Each line has a one-line comment explaining the var. AC: no secrets; safe to commit.

### Checkpoint gate
- [ ] `docker build .` succeeds; server starts
- [ ] `deploy/bootstrap.sh` runs clean on Debian 12
- [ ] `scripts/deploy.sh` pushes and restarts in <60 s
- [ ] security review: Dockerfile runs non-root, bootstrap file permissions, no secrets in committed files
- [ ] ntfy: CP12g sealed

---

### CP12 End-of-Arc Audit
1. `npx tsc --noEmit` — zero errors
2. `npm test` — zero failures
3. `security-review` skill on all CP12 changes
4. Manual code quality pass: dead code, over-engineering, missing tests
5. Generate new TASKS.md from findings

---

## CP13 — Clone-Ready Hardening & First-Run Setup

> **Position**: After CP12 complete.
> **Theme**: Genericise all personal identifiers; add a `koa setup` wizard so anyone can clone
> the repo and configure their own instance without touching source code.
> **Done-when**: `git clone` + `koa setup` produces a fully working personal assistant with
> no owner-specific values in the codebase; all T1 secrets validated at startup.

---

### Critical pre-work (do before implementation)

- [x] **Verify `.env` was never committed** — confirmed: `git log --all --full-history -- .env`
  returns no commits. The working tree `.env` is gitignored and has never entered history.
  API key rotation is not required; the key has not been exposed via git.

---

### CP13a — Configuration taxonomy & `userName` plumbing

**Done when**: `KOA_USER_NAME` flows from env → config.json → `'User'` default into the system
prompt and memory tool; no "Ralph" strings remain in committed TypeScript source.

- [ ] `src/config/index.ts`
  - Add `userName: z.string().default('User')` to `ConfigSchema` (after `browserEnabled` line)
  - Add `userName?: string` to `KoaConfigFile` interface
  - Add `userName: process.env['KOA_USER_NAME'] ?? fileConfig.userName ?? 'User'` to
    `loadConfig()` return object

- [ ] `src/agent/specialists.ts`
  - Convert `LM_SYSTEM` string constant to `buildLmSystem(userName: string): string` function
    that replaces the two "Ralph" occurrences with `${userName}`
  - Convert `AGENT_SPECS` constant to `buildAgentSpecs(userName: string)` factory function
  - Keep `export const AGENT_SPECS = buildAgentSpecs('User')` for backward-compat with tests

- [ ] `src/agent/loop.ts`
  - Store `private agentSpecs = buildAgentSpecs(config.userName ?? 'User')` in constructor
  - Replace all `AGENT_SPECS[...]` references with `this.agentSpecs[...]`

- [ ] `src/agent/tools/memory_tool.ts`
  - Convert `rememberTool` to `createRememberTool(userName: string = 'User'): Tool` factory
  - Keep `export const rememberTool = createRememberTool('User')` for backward-compat
  - Update example sentence in description from "Ralph's wife Jeni..." to `"${userName}'s..."`

- [ ] `src/cli/index.ts`
  - Import `createRememberTool` instead of `rememberTool`
  - In `buildRegistry()`, replace `registry.register(rememberTool)` with
    `registry.register(createRememberTool(config.userName ?? 'User'))`

### Checkpoint gate (CP13a)
- [ ] tsc clean
- [ ] npm test all pass — all tests that import `rememberTool` / `AGENT_SPECS` directly still work
- [ ] New test: `buildAgentSpecs('Alice')` asserts `'Alice'` appears in the generated spec strings (prevents regression in userName plumbing)
- [ ] `grep -r "Ralph" src/` returns zero hits

---

### CP13b — ntfy parameterisation

**Done when**: `scripts/checkpoint.sh` reads `NTFY_TOPIC` from `~/.koa/credentials` (or
`KOA_NTFY_TOPIC` env var) and skips with a warning when unset. Hardcoded topic string gone.
`src/notifications/escalation.ts` and `src/server/routes/admin.ts` use the same pattern.

- [ ] `scripts/checkpoint.sh`
  - Replace hardcoded `NTFY_URL="https://ntfy.sh/<ntfy-topic>"` with a credentials-file
    lookup. Use safe extraction: `NTFY_TOPIC=$(grep -Po '(?<=^NTFY_TOPIC=).*' ~/.koa/credentials 2>/dev/null || true)`,
    fall back to `KOA_NTFY_TOPIC` env var. Default base URL to `https://ntfy.sh` via same pattern
    for `NTFY_BASE_URL` / `KOA_NTFY_BASE_URL`. If `NTFY_TOPIC` is empty, print a warning to
    stderr and exit 0.
  - Validate `NTFY_TOPIC` matches `[a-zA-Z0-9_-]` only (guard against injection); reject and
    warn if invalid. Always quote `"$NTFY_TOPIC"` in URL construction — never unquoted interpolation.

- [ ] `src/notifications/escalation.ts`
  - Replace any hardcoded ntfy topic with `readCredentials()['NTFY_TOPIC']` and
    `readCredentials()['NTFY_BASE_URL'] ?? 'https://ntfy.sh'`
  - Skip send (log warning) when `NTFY_TOPIC` is unset

- [ ] `src/server/routes/admin.ts`
  - Same pattern as escalation.ts — topic read from credentials, skip if unset
  - The test-send endpoint at `/api/admin/ntfy/test` should return a 400 with a clear message
    when `NTFY_TOPIC` is not configured, rather than sending to an undefined URL

- [ ] `.env.example`
  - Add `KOA_NTFY_TOPIC=` and `KOA_NTFY_BASE_URL=https://ntfy.sh` entries under a T2 Personal block

### Checkpoint gate (CP13b)
- [ ] tsc clean
- [ ] npm test all pass
- [ ] `grep -r "$KOA_NTFY_TOPIC" .` returns zero hits in committed source files
- [ ] security review: no credential leakage in ntfy send paths

---

### CP13c — `koa setup` wizard

**Done when**: Running `koa setup` on a fresh clone walks the user through all T1 and T2 values,
writes to `~/.koa/credentials` and `~/.koa/config.json`, and exits cleanly. Headless mode
(`--headless`) validates T1 values or exits 1 with a descriptive error (for Docker/CI).

- [ ] `src/cli/index.ts` — Add `setup` subcommand:
  ```
  koa setup [--reset] [--headless]
  ```
  Uses `readline/promises` (no new dependencies). Five steps in order:
  1. **Anthropic API key** (T1) — validates `sk-ant-` prefix + length ≥ 20 chars; writes via
     `setApiKey()`. Skips if already set (unless `--reset`). Note: liveness is not validated
     at setup time (no test API call); a syntactically-valid-but-revoked key will fail at first
     use. Document this clearly in the wizard output: "Key format OK — will validate on first use."
  2. **Web console token** (T1) — offer auto-generate (64-char hex via `generateWebToken()`) or
     manual entry (min 16 chars); writes via `setWebToken()`. Skips if already set.
  3. **Your name** (T2) — writes to `~/.koa/config.json` as `"userName"`. Default: `User`.
  4. **ntfy notifications** (T2, optional) — topic name (validates `[a-zA-Z0-9_-]` only),
     server URL (validates with `validateSafeUrl()`), optional test send.
  5. **Default project path** (T2, optional) — validates path exists; writes to `config.json`.
  - Headless mode: validate T1 values from env/credentials; exit 1 listing missing keys if any.
  - Idempotent: re-run without `--reset` only prompts for unset values.

### Checkpoint gate (CP13c)
- [ ] tsc clean
- [ ] npm test all pass
- [ ] Manual: `koa setup` on a fresh `KOA_HOME` completes end-to-end
- [ ] Manual: `KOA_NTFY_TOPIC=test koa setup --headless` exits 0 when ANTHROPIC_API_KEY is set
- [ ] Manual: `koa setup --headless` with no API key exits 1 with a clear error message
- [ ] security review: ntfy topic validation (no path traversal), URL validation on server field

---

### CP13d — Repo sanitisation & template files

**Done when**: The repo ships no personal identifiers in committed files; cloners get
`.env.example`, `config.example.json`, and `.claude/settings.example.json` as starting points.

- [ ] `.gitignore` — add `.claude/settings.json` (personal harness permissions are machine-specific)
- [ ] `.claude/settings.example.json` — rename/copy from `.claude/settings.json`; replace
  absolute paths with `<PROJECT_ROOT>` string placeholders (not shell substitutions — JSON files
  do not evaluate `$(…)`); add comment header explaining cloners must copy to `settings.json`
  and replace `<PROJECT_ROOT>` with their actual path (or use `koa setup` to generate it)
- [ ] `config.example.json` — create at repo root; document every `KoaConfigFile` field with
  one-line comments; no personal values
- [ ] `.env.example` — add T2 section with `KOA_USER_NAME`, `KOA_NTFY_TOPIC`, `KOA_NTFY_BASE_URL`
- [ ] `README.md` — replace `git clone git@github.com:<your-username>/koa.git` placeholder set;
  replace personal bio line
- [ ] `CONTRIBUTING.md` — replace `git clone git@github.com:<your-username>/koa.git` placeholder set;
  add note that `ai-review.yml` requires an `ANTHROPIC_API_KEY` secret in fork's GitHub settings
- [ ] `docs/PERSONA.md` — add top-of-file note directing cloners to set `KOA_USER_NAME`;
  replace inline "Ralph" references with `${KOA_USER_NAME}` placeholder markers

### Checkpoint gate (CP13d)
- [ ] `grep -rn "rwgb\|undaunting_underpants\|ralph\.brynard\|/Users/ralph" . --include="*.ts" --include="*.sh" --include="*.yml" --include="*.md" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git --exclude=TASKS.md` returns zero hits
- [ ] `.claude/settings.json` is in `.gitignore`; `settings.example.json` committed instead
- [ ] security review: no personal data or credentials in committed files

---

### CP13 End-of-Arc
- [ ] Full tsc clean; npm test all pass
- [ ] `koa setup` tested end-to-end on a clean temp `KOA_HOME`
- [ ] Security review on all CP13 changes
- [ ] ntfy: CP13 sealed

---

## Memory System Re-Architecture

**Done when**: Session-to-session continuity is smooth — one 60-second read at session start, no stale architecture docs, no stale CLI refs.

### Changes
- [ ] Delete `~/.claude/projects/.../memory/project_koa.md` — architecture is in the code/ARCHITECTURE.md; this file only rots
- [ ] Delete `~/.claude/projects/.../memory/reference_engram.md` — CLI commands are in the actual scripts; this file only rots
- [ ] Rename `STATE.md` → `HANDOFF.md` and restructure it as a session-to-session handoff doc:
  - Frontmatter: `written`, `branch`, `tests | tsc | lint` status
  - Sections: **Where We Are** (plain-English paragraph), **Active Branch** (what's on it + what it needs), **What's Next** (ordered list), **Open Questions** (unresolved tradeoffs), **Don't Restart** (things tried + abandoned + why)
- [ ] Slim `MEMORY.md` — remove stale project status line; keep only feedback files + HANDOFF.md pointer
- [ ] Add a project-level `CLAUDE.md` to the koa repo: "At session start, read `memory/HANDOFF.md` first. It's authoritative. Skip DEVLOG.md unless you need history."
- [ ] Update the checkpoint routine (§16 of global CLAUDE.md) to rewrite `HANDOFF.md` after each checkpoint instead of updating `STATE.md`

### Acceptance criteria
- [ ] Session start requires reading exactly 1 file to be fully oriented
- [ ] No memory file describes architecture or CLI commands (those live in the repo)
- [ ] HANDOFF.md is rewritten by the checkpoint routine — always fresh, never stale

---

## Koa ↔ Engram Feedback Loops

Two sequential workstreams. Must do **Prerequisite** first — nothing else works without it.

---

### Prerequisite — CI + Tests for Engram

**Context**: Engram is already a git repo at `~/active projects/engram` with remote
`https://github.com/rwgb/engram.git`. `~/.claude/skills/engram` is now a symlink to it —
global hooks and koa's `ENGRAM_CLI` constant both resolve correctly with no code changes needed.

**Done when**: Engram has a passing CI on GitHub and a pytest smoke suite locally.

- [ ] Add `~/active projects/engram/tests/` with 3 smoke tests:
  - `test_db.py` — `open_brain()` creates schema without error on a temp path
  - `test_search.py` — `search()` on an empty brain returns `[]`, not an exception
  - `test_session.py` — `start_session()` / `close_session()` round-trip writes and reads back
- [ ] Add `~/active projects/engram/pyproject.toml`:
  ```toml
  [project.optional-dependencies]
  dev = ["pytest", "pytest-cov"]
  [tool.pytest.ini_options]
  testpaths = ["tests"]
  ```
- [ ] Add `~/active projects/engram/.github/workflows/ci.yml`:
  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: "3.12" }
        - run: pip install -e ".[dev]" -r requirements.txt
        - run: python -m pytest tests/ -q
  ```
- [ ] Commit and push — confirm CI green on `github.com/rwgb/engram`

### Acceptance criteria (Prerequisite)
- [ ] `python -m pytest tests/` passes locally — 3 tests, 0 failures
- [ ] GitHub Actions CI green on first push to engram
- [ ] `ls -la ~/.claude/skills/engram` shows symlink → `~/active projects/engram` ✅ (done)

---

### Loop 1 — Reactive (Push-Triggered Cross-Repo Patch)

**Done when**: Pushing a koa commit that touches `src/engram/client.ts` automatically opens a PR on the Engram repo if an interface change is detected.

**Depends on**: Prerequisite complete.

- [ ] `scripts/engram-impact.js` — new script, same structure as `scripts/ai-review.js`:
  - Reads the diff of `src/engram/client.ts` from the GitHub API (using `GH_TOKEN`)
  - Fetches current Engram Python files from `github.com/<your-username>/engram` via GitHub API
  - Calls Claude API (Sonnet): "does this koa diff require a change to Engram's Python? If yes, produce the patch."
  - If patch needed: opens a PR on the Engram repo with the generated change
  - Posts a comment on the koa PR: "⚠️ Engram interface change detected — Engram PR #N opened"
  - If no patch needed: posts "✅ No Engram changes required"
  - AC: script exits 0 in both cases (never blocks the koa PR)

- [ ] `.github/workflows/engram-impact.yml` — new workflow in koa:
  ```yaml
  name: Engram Impact Check
  on:
    pull_request:
      paths: [src/engram/client.ts]  # only fires when the interface file changes
  permissions:
    contents: read
    pull-requests: write
  jobs:
    impact:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22 }
        - run: node scripts/engram-impact.js
          env:
            ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            ENGRAM_REPO: rwgb/engram
            PR_NUMBER: ${{ github.event.pull_request.number }}
            GITHUB_SHA: ${{ github.event.pull_request.head.sha }}
  ```

- [ ] Add `ENGRAM_REPO` to the koa repo's GitHub Actions secrets (or env — it's not sensitive)
- [ ] End-to-end test: make a trivial change to `client.ts` (e.g. add a comment), open a PR, confirm the workflow fires and posts a "no changes required" comment

### Acceptance criteria (Loop 1)
- [ ] `engram-impact.yml` fires only on PRs that touch `src/engram/client.ts`
- [ ] A real interface change (e.g. calling a new CLI flag) produces a patch PR on the Engram repo
- [ ] A non-breaking change produces a "no changes required" comment
- [ ] koa CI never fails because of this check (script always exits 0)

---

### Loop 2 — Proactive (Local Quality Signal Collector)

**Done when**: Koa silently tracks Engram quality during sessions and surfaces improvement opportunities in HANDOFF.md; the main agent loop can apply patches to Engram on demand.

**Does not depend on Loop 1** — runs entirely locally, no GitHub required.

- [ ] `src/engram/signals.ts` — signal collector:
  ```typescript
  type SignalType = 'thin-context' | 'empty-query' | 'failed-call' | 'slow-sync' | 'poor-recall';
  interface EngramSignal { ts: string; type: SignalType; detail: string; }
  // append-only write to ~/.koa/signals/engram.jsonl
  // exported: emitSignal(type, detail), readRecentSignals(n): EngramSignal[]
  ```
  - Wrap `EngramClient.getContext()`: if result has no goal and no sessionSummary → emit `thin-context`
  - Wrap `EngramClient.query()`: if result is empty string → emit `empty-query`
  - Wrap `EngramClient.sync()`: if wall-clock >15 000ms → emit `slow-sync`
  - Wrap `EngramClient.rememberSession()`: on exception → emit `failed-call`

- [ ] `AgentLoop.finalize()` — after `rememberSession`, call `readRecentSignals(20)`:
  - Count signals by type in the last 20 entries
  - If any type has ≥3 occurrences: append a `## Pending Engram Work` section to HANDOFF.md
    listing the signal type, count, and a one-line description of what it means

- [ ] `src/agent/tools/cross_repo.ts` — three tools behind an allowlist:
  ```typescript
  const ALLOWLIST = { engram: path.join(os.homedir(), 'active projects/engram') };
  // cross_repo_read(repo, relPath) → file contents
  // cross_repo_write(repo, relPath, content) → writes file
  // cross_repo_run_tests(repo) → runs pytest, returns stdout + pass/fail
  ```
  - `repo` arg must be a key in `ALLOWLIST` — reject anything else
  - `cross_repo_write` refuses to write outside the allowlisted root (path traversal guard)
  - Registered in `registry.ts` alongside the existing tools

- [ ] Wire `cross_repo` tools into `AgentLoop` so the main agent can call them during a turn
  - No new permission needed — the main loop already executes bash; these are more restricted

### Acceptance criteria (Loop 2)
- [ ] After a session where `getContext()` returns empty: a signal is written to `~/.koa/signals/engram.jsonl`
- [ ] After 3+ thin-context signals: HANDOFF.md contains a `## Pending Engram Work` section next session
- [ ] `cross_repo_read` can read a file from `~/.claude/skills/engram/` and `cross_repo_write` can write one back
- [ ] `cross_repo_write` with a path like `../../.ssh/id_rsa` is rejected
- [ ] `cross_repo_run_tests` runs pytest and returns the output

---

## Memory System Re-Architecture

Items worth watching — not yet specced, revisit after CP13.

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

---

## OpenClaw Reference Items

> Patterns learned from a deep review of [openclaw/openclaw](https://github.com/openclaw/openclaw)
> (377k stars, 78k forks). Not specced yet — revisit when the relevant arc is in scope.
> Full comparison written 2026-06-08; ask Claude Code to recall it for context.

- **Token-budget compaction** — Replace the `compactAfterTurns * 2` message-count heuristic in
  `src/agent/loop.ts` with a check against the active model's context window using two constants:
  `MIN_PROMPT_BUDGET_TOKENS = 8_000` (absolute floor) and `MIN_PROMPT_BUDGET_RATIO = 0.5`
  (minimum share of window). The `TurnUsage` data already tracked makes this a one-function
  change. Risk today: a heavy-tool-output session can overflow the context window before the
  message count fires.

- **`koa doctor --fix` config migrations** — When config keys change between releases, existing
  `~/.koa/config.json` silently breaks. Add a `koa doctor` CLI command that detects old shapes
  (e.g. missing `provider` field, old `smartRouting: true` → `provider: auto`), backs them up,
  and rewrites to canonical format. Openclaw treats this as a first-class citizen alongside every
  config change.

- **Koa-owned SQLite for first-party state** — `~/.koa/signals/engram.jsonl` and flat-file session
  data should move to `~/.koa/koa.db` (Kysely, one table per concern: `signals`, `sessions`,
  `preferences`). Engram's `brain.db` stays Python-owned. Benefits: atomic writes, indexed
  queries, proper migration history, no JSONL parsing edge cases. Openclaw rule: all runtime state
  in SQLite; file storage only for named product artifacts.

- **Executable security invariant tests** — Add `src/__tests__/security/` with assertions that
  existing security properties haven't regressed: path traversal rejected by `sandboxPath()`,
  CORS wildcard rejected, bash timeout clamped at 300s, `/api/chat` returns 429 when busy, SSE
  error payload contains no stack frames. Openclaw's `src/security/` has 80+ such files. These
  aren't new features — they're regression guards.

- **Context engine interface extraction** — As Engram, SpiderBrain, working memory markdown, and
  journal entries all feed into the system prompt, the inline assembly in `loop.ts` will become
  unmaintainable. Extract a `ContextProvider` interface with `provide(budget: number): ContextSlice`.
  Register each source (Engram, SpiderBrain, WorkingMemory) separately; the engine merges them
  token-budget-aware. Decouples memory backends from the agent loop and makes each provider
  independently testable. The 1041-line `loop.ts` is the signal this is needed.
