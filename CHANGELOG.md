# Changelog

All notable changes to Koa are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [1.0.0] — 2026-06-10

First stable release. Everything below the 0.3.0 line shipped during the 0.x hardening arc; 1.0.0 adds the self-updater, multi-instance GitHub support, a full dependency refresh, and a release-wide end-to-end audit (see `docs/AUDIT-V1.md`).

### Added
- `koa update` — self-update with automatic rollback: `--ff-only` pull pinned to the configured upstream, `dist/` snapshot restored if the build or test verification fails, ntfy notification on success and rollback; `--check`, `--no-test`, `--force` flags (CP18)
- Multi-instance GitHub integration — configure multiple accounts/tokens with per-instance default repo; agent tools resolve credentials by target repo owner; "add another" flow in the web console (CP19)
- ClaudeCode provider fallback on Anthropic 429/quota exhaustion (CP16)
- Engram signal collector and cross-repo tools (CP15)
- Token-budget context compaction with dynamic thresholds for 200k models; `koa doctor --fix` config migration; per-project `budget_usd` spending guards (CP17)

### Changed
- Major dependency refresh: `@anthropic-ai/sdk` 0.104, `zod` 4, `commander` 15, `ink` 7, `react` 19, `better-sqlite3` 12, plus dev/web dependency groups and GitHub Actions bumps
- Excess CLI arguments now error instead of being silently ignored (commander 15 behavior)
- Web console on the Obsidian Pro theme

### Fixed
- Pre-v1 audit findings across all feature areas — confirmed HIGH/MEDIUM issues fixed under QA + security gates; remaining known issues listed in `docs/AUDIT-V1.md`
- `scripts/checkpoint.sh` ntfy topic extraction silently failing on macOS (GNU-only `grep -P`)

### Security
- Audit-verified: route authentication coverage, secret masking on API responses, SSRF validation on configurable URLs, sandbox isolation
- Documented accepted risks: updater trusts the configured upstream (no commit signature verification); ntfy topic acts as a bearer-style credential

## [0.3.0] — CP13 end-of-arc

- Security hardening arc: SSRF fixes (including IPv6), `koa setup` wizard, ntfy parameterisation, repo sanitisation and template files, lint/test cleanup (627 tests)
- ClaudeCodeProvider with automatic routing; ntfy topic validation (CP14)

## [0.2.0]

- Web console (admin UI), context compression, channels (Slack/Gmail), voice (TTS/ElevenLabs/Whisper), iOS + watchOS companion apps, GitHub integration, calendar/email, plugin SDK, sandboxed execution, Playwright browser automation, Ollama provider, homelab deployment scaffolding (CP7–CP12g)

## [0.1.0]

- Initial CLI: Engram-aware Claude agent loop with TUI, layered memory (Engram + SpiderBrain + project markdown), specialist agent dispatch
