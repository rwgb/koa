---
written: 2026-06-11
branch: feature/web-console-and-hardening
tests: 831
tsc: clean
tip: 4b523e0 (+ uncommitted CP20+CP21+hotfix working tree)
---

## Where We Are

CP21 + hotfix done. Server rebuilt and restarted (pid 83540, port 3000) — chat working via quota fallback.

- **CP21**: quota-fallback model/cost attribution ($0 for ClaudeCode turns), conversation auto-titling (lazy create + title after first exchange), version badge sources package.json. Anthropic API key over monthly limit until 2026-07-01 — every turn routes through ClaudeCode CLI.
- **Hotfix (chat transcript persistence)**: chat replies were appearing in Activity but not the chat window. Root cause: `ChatPage` owned the transcript + SSE stream; route unmount (navigation during the 20–40s fallback turn) aborted the stream and wiped state. Fixed by lifting stream + transcript into `ChatContext` above the router, with DB hydration on load.
- **Calendar flicker**: fixed — `monthStart`/`monthEnd` memoized, `weekEnd` moved inside callback, stable `key` on grid cells.

## Active Branch

`feature/web-console-and-hardening` — CP21 + hotfix complete.

## What's Next

1. Commit the CP20+CP21+hotfix working-tree changes (atomic commits), open PR
2. Tag v1.0.0
3. Fix `koa --version` hardcode in `src/cli/index.ts` (same disease as the web badge — read from package.json)

## Open Questions

(none)

## Don't Restart

- Tried Tailscale TLS certs: requires paid plan. HTTP over WireGuard is sufficient.
- Tried setInterval for briefing at 08:00: deferred to CP10e (not yet started).
- iOS real-device test via Tailscale: deferred indefinitely (skipped by user).

## Completed Checkpoints (reference)

| CP | Label | Status |
|----|-------|--------|
| CP0 | Admin UI Phase 1 | done |
| CP7–CP10c | DB, channels, voice, iOS, server refactor, calendar/email | done |
| CP10a | iOS Keychain hardening + Siri fix | done |
| CP10d | GitHub integration | done |
| CP10f | iOS search tab + TTS voice round-trip | done |
| CP11a–CP11d | ElevenLabs, multi-agent chaining, conversation persistence, watchOS | done |
| CP12a–CP12g | Plugin SDK, context compaction, Ollama, conv intelligence, sandbox, browser, homelab | done |
| CP13–CP13d | Security hardening, userName, ntfy param, koa setup, repo sanitisation | done |
| CP14 | ClaudeCodeProvider + auto routing + ntfy topic validation | done |
| CP15 | Engram Loop 2: signals.ts + cross_repo tools + HANDOFF wiring | done |
| CP16 | ClaudeCode fallback on Anthropic 429/quota exhaustion | done |
| CP17 | OC-1 token-budget compaction + OC-2 koa doctor + R-3 per-project budgets | done |
| CP18 | koa update with automatic rollback | done |
| CP19 | Multi-instance GitHub configuration | done |
| CP20 | Audit fixes + api-cost-opt p1–3 + smart-routing | done |
| CP21 | Quota fallback attribution, conversation auto-titling, version badge | done |
| Hotfix | Chat transcript persistence (stream + state lifted out of route component) | done |
