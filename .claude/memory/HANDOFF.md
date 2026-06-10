---
written: 2026-06-10
branch: feature/cp15-engram-loops
tests: 651 passing
tsc: clean
---

## Where We Are

CP15 + CP16 + Fable audit fixes merged into `feature/web-console-and-hardening` via PR #17 (merged 2026-06-10). iOS real-device test deferred indefinitely.

## Active Branch

feature/cp15-engram-loops — all CP15/CP16/audit work landed. Ready for CP17.

## What's Next

1. CP17 (TBD)

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
| CP11a | Conversation persistence | done |
| CP11b | True multi-agent chaining | done |
| CP11c | ElevenLabs TTS | done |
| CP11d | watchOS companion app | done |
| CP12a | Plugin/tool extensibility SDK | done |
| CP12b | Semantic context-window compaction | done |
| CP12c | Ollama self-hosted LLM provider | done |
| CP12d | Conversation intelligence (auto-title + search) | done |
| CP12e | Sandboxed code execution | done |
| CP12f | Browser automation via Playwright | done |
| CP12g | Homelab deployment scaffolding | done |
| CP13 | Security hardening + lint + test fixes | done |
| CP13a | userName plumbing | done |
| CP13b | ntfy parameterisation | done |
| CP13c | `koa setup` wizard + IPv6 SSRF fix | done |
| CP13d | Repo sanitisation & template files | done |
| CP14 | ClaudeCodeProvider + auto routing + ntfy topic validation | done |
| CP15 | Engram Loop 2: signals.ts + cross_repo tools + HANDOFF wiring | done |
| CP16 | ClaudeCode fallback on Anthropic 429/quota exhaustion | done |
