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
| CP21 | Quota fallback attribution, conversation auto-titling, version badge | ✅ done 2026-06-11 |
| Hotfix | Chat transcript persistence (stream + state lifted out of route component) | ✅ done 2026-06-11 |
| v1.0.0 | main + develop synced, tag pushed, production deployed via rsync | ✅ done 2026-06-12 |
| Prod Claude Code | Installed claude CLI + copied OAuth creds to koa user; quota fallback live on prod | ✅ done 2026-06-12 |
| CP22–CP26 | Web console hardening, ElevenLabs TTS, settings, debug console | ✅ done (see DEVLOG) |
| Architecture | CONTEXT.md + 6 ADRs + project cleanup | ✅ done 2026-06-16 |
| Fix queue | synthesizeSpeech, MODEL_CONTEXT_WINDOWS, OAuth TTL, browserEnabled, Slack cap, graceful drain | ✅ done 2026-06-16 |
| CP27-A/B/E | SQLite memory schema + 8 typed event writes + write_memory_event tool | ✅ done 2026-06-16 |
| CP27-C/D | BM25/RRF retrieval pipeline + per-turn system prompt injection | ✅ done 2026-06-16 |
| CP29-A/B | EventBus namespace.verb pattern + action_type dispatch (notify/brief/agent) | ✅ done 2026-06-16 |
| CP29-C | TurnScheduler replaces isBusy — priority queuing, no more 429s | ✅ done 2026-06-16 |
| — | Multi-instance integrations (gmail, google-calendar, slack, mcp_server) + security fixes | ✅ done 2026-06-23 |

## Current State (2026-06-23)

- Branch: `feature/web-console-and-hardening` — all changes committed (tip: 305ad38)
- Tests: 910 passing, 0 failing | tsc: clean
- Multi-instance integrations complete; Google Calendar OAuth working
- Production (192.168.1.200): still on v1.0.0 — feature branch not yet merged/deployed

## Next

- [ ] Deploy feature branch to LXC (scripts/deploy.sh) — migration 11 will run on startup
- [ ] Test multi-instance: add second Gmail/Calendar account from UI
- [ ] Open PR for feature/web-console-and-hardening → main (v1.1.0)
- [ ] Publish Google OAuth app (removes test-user restriction permanently)
