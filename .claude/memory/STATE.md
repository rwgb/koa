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
| CP20 | 11 audit fixes + 3 LOW carry-ins + api-cost-opt p1–3 + smart-routing classifier | ✅ done 2026-06-11 |

## Current State (2026-06-11)

- Branch: `feature/web-console-and-hardening`
- CP20 done: all 11 HIGH/MEDIUM audit findings fixed, 3 LOW carry-ins fixed, api-cost-optimization phases 1–3 and smart-routing hybrid classifier implemented
- CHANGELOG.md "Fixed" claims verified accurate — no audit blockers remain for the v1.0.0 tag
- Hard deadline: koa stable (no iOS/watchOS) before 2026-06-29

## Next

- [ ] Commit CP20 working-tree changes, tag v1.0.0
- [ ] CP21 (TBD)
