---
name: backlog-burn-state
description: CP completion status and what's next
metadata:
  type: project
---

# Koa — Backlog Burn State

## Completed Checkpoints

| CP | Label | Status |
|----|-------|--------|
| CP0 | Admin UI Phase 1 | ✅ done |
| CP7–CP10c | DB, channels, voice, iOS, server refactor, calendar/email | ✅ done |
| CP10d | GitHub integration | ✅ done |
| CP10f | iOS search tab + TTS voice round-trip | ✅ done |
| CP11a | Conversation persistence | ✅ done (bundled in CP10e) |
| CP11b | True multi-agent chaining | ✅ done |
| CP11c | ElevenLabs TTS | ✅ done (bundled in CP10e) |
| CP11d | watchOS companion app | ✅ done |
| CP12a | Plugin/tool extensibility SDK | ✅ done |
| CP12b | Semantic context-window compaction | ✅ done |
| CP12c | Ollama self-hosted LLM provider | ✅ done |
| CP12d | Conversation intelligence (auto-title + search) | ✅ done |
| CP12e | Sandboxed code execution | ✅ done |
| CP12f | Browser automation via Playwright | ✅ done |
| CP12g | Homelab deployment scaffolding | ✅ done |
| CP13 | Security hardening + lint + test fixes | ✅ done |
| CP13a | userName plumbing | ✅ done |
| CP13b | ntfy parameterisation | ✅ done |
| CP13c | `koa setup` wizard + IPv6 SSRF fix | ✅ done |
| CP13d | Repo sanitisation & template files | ✅ done |
| CP13 End-of-Arc | Security review clean, 627 tests, tsc clean, v0.3.0 bump | ✅ done |
| CP14 | ClaudeCodeProvider + auto routing + ntfy topic validation | ✅ done |
| CP15 | Engram signal collector + cross-repo tools (Loop 2) | ✅ done |
| CP16 | ClaudeCode fallback on Anthropic quota exhaustion | ✅ done |
| Fable Audit | ~30 fixes from FABLE_AUDIT_FIXES.md — §A/§B/§C/§D | ✅ done 2026-06-10 |
| Obsidian Pro Theme | Winning UI theme applied to web console | ✅ done 2026-06-10 — commit 938b183 |
| Housekeeping Sprint | H-1–H-8, EL-1/EL-2, iOS-1 — 10 fixes | ✅ done 2026-06-10 — commit b08dc75 |
| CP17 | OC-1 token-budget + OC-2 koa doctor + R-3 per-project budgets | ✅ done 2026-06-10 |
| CP18 | koa update with automatic rollback (--check/--no-test/--force) | ✅ done 2026-06-10 — PR #19 merged |
| Deps fold-in | dependabot #11/#13–#16 + compat fixes (SDK 0.104, zod 4, etc.) | ✅ done 2026-06-10 — PR #20 merged |
| CP19 | multi-instance GitHub integration | ✅ done 2026-06-10 — PR #21 merged |

## Current State (2026-06-10)

- Branch: `chore/deps-compat` (off feature/web-console-and-hardening)
- CP18 merged (PR #19): koa update self-updater, 811 tests at merge
- Dependabot PRs #11/#13/#14/#15/#16 merged (SDK 0.104, zod 4, commander 15, ink 7, react 19, better-sqlite3 12); #12 (actions/checkout) awaiting dependabot merge — needs `workflow` scope or @dependabot command
- v1 full audit run wf_84003079-68c: audit+verify completed; fix/gate/report killed by session-limit — NOT RESUMABLE (fix agents died, no source changes to cache)
- 11 confirmed HIGH/MEDIUM, 0 refuted — full list in DEVLOG.md [2026-06-11] session entry
- CRITICAL: CP16 fallback NOT on release branch (needs reimplementation); cache_control accumulation bug causes hard 400 failures
- Fix workflow to be re-launched fresh once session resets (01:20 CT)
- v1.0.0 push: CP19 (multi-instance GitHub) → full E2E audit → release prep (CHANGELOG, TASKS.md cleanup, ntfy topic rotation) → release

## Merge State

- `feature/context-compression` → `develop` ✅ merged
- PR #3 (`develop` → `main`) ✅ squash-merged, v0.2.0 released
- Branch protection on `main` + `develop`: CI required
- PR #17 (`feature/cp15-engram-loops` → `feature/web-console-and-hardening`) ✅ merged 2026-06-10

## Next

- [ ] Merge feature/cp17 → feature/web-console-and-hardening (PR)
- [ ] CP18: `koa update` with automatic rollback (scoped 2026-06-10)
  - git pull + npm run build; snapshot dist/ before build; restore on failure
  - CLI: `koa update`, `--check`, `--no-test`, `--force`
  - New module: `src/updater/index.ts`
  - ntfy ping on success and rollback
