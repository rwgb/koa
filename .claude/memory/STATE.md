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

## Current State (2026-06-10)

- Branch: `feature/cp17`, tip `a910a49`
- 799 tests passing, tsc clean
- CP17 complete: OC-1 dynamic token-budget compaction, OC-2 koa doctor --fix, R-3 per-project budget_usd guard
- PR pending: feature/cp17 → feature/web-console-and-hardening

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
