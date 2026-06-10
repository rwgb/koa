---
written: 2026-06-10
branch: feature/cp16-claude-fallback
tests: 651 passing
tsc: clean
---

## Where We Are

CP16 is complete — ClaudeCode fallback on Anthropic 429/quota exhaustion delivered. PR created against `feature/web-console-and-hardening`. CP15 and CP14 PRs are open against `develop`.

## Active Branch

feature/cp16-claude-fallback — ClaudeCode fallback on quota exhaustion. PR created → feature/web-console-and-hardening.

## What's Next

1. Merge CP16 PR → develop
2. iOS real-device test via Tailscale (100.101.19.77:3000)

## Open Questions

(none)

## Don't Restart

- Tried Tailscale TLS certs: requires paid plan. HTTP over WireGuard is sufficient.
- Tried setInterval for briefing at 08:00: deferred to CP10e (not yet started).

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
