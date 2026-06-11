---
written: 2026-06-10
branch: feature/cp17
tests: 799
tsc: clean
tip: a910a49
---

## Where We Are

CP17 complete. OC-1 (dynamic token-budget compression threshold — 100k for 200k models), OC-2 (koa doctor --fix CLI migration command), R-3 (per-project budget_usd + session-cost guard in agent loop). 799 tests, tsc clean.

## Active Branch

feature/cp17 — CP17 complete, PR pending against feature/web-console-and-hardening.

## What's Next

1. Merge feature/cp17 → feature/web-console-and-hardening (PR)
2. CP18 — decide scope (candidates: context engine interface extraction, webhook-triggered delegations, ambient dashboard)

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
