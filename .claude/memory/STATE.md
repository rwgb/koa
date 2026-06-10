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

## Fable Audit State (2026-06-10)

- All ~30 fixes applied and committed to `feature/cp15-engram-loops`
- Note: fixes landed on `feature/cp15-engram-loops` (not `feature/audit-fixes`) because the repo
  was checked out to that branch when the workflow ran. `feature/audit-fixes` diverged from a
  common CP13 ancestor via a squash commit — the audit work builds on CP15/CP16 which are only
  in `feature/cp15-engram-loops`.
- 765 tests passing, tsc clean, security review clean (0 CRITICAL/HIGH/MEDIUM)
- **CRITICAL action needed**: rotate `ANTHROPIC_API_KEY` in `.env` (was plaintext)

## Merge State

- `feature/context-compression` → `develop` ✅ merged 2026-06-04
- `develop` → `main` PR #3 ✅ squash-merged 2026-06-05 (commit `f5f46bcb`)
- GitHub Release `v0.2.0` ✅ created 2026-06-05
- Branch protection on `main`: requires `ci / Lint, typecheck & test` + `ai-review`
- Branch protection on `develop`: requires `ci / Lint, typecheck & test`
- CI + AI review + release workflows fully operational
- PR #5 (`feature/cp13-clone-ready` → `develop`) ✅ merged
- PR #6 (`develop` → `main`, v0.3.0) 🔄 open — CI passing, awaiting merge

## Next

- [ ] **CRITICAL**: Rotate `ANTHROPIC_API_KEY` in `.env` before any push
- [ ] PR: `feature/cp15-engram-loops` → `feature/web-console-and-hardening` (includes CP14+CP15+CP16+Fable audit)
- [ ] Merge PR #6 → GitHub Release v0.3.0
- [ ] CP17: Long-term memory — spec in `docs/MEMORY-SPEC.md`; branch `feature/cp17-longterm-memory`
