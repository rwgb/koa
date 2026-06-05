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

## Merge State

- `feature/context-compression` → `develop` ✅ merged 2026-06-04
- `develop` → `main` PR #3 ✅ squash-merged 2026-06-05 (commit `f5f46bcb`)
- GitHub Release `v0.2.0` ✅ created 2026-06-05
- Branch protection on `main`: requires `ci / Lint, typecheck & test` + `ai-review`
- Branch protection on `develop`: requires `ci / Lint, typecheck & test`
- CI + AI review + release workflows fully operational

## Current Arc — CP13: Clone-Ready Hardening (2026-06-05)

- PR #4 (docs sync) ✅ merged to main 2026-06-05
- `.env` credential check ✅ never committed — no key rotation needed
- AI review findings in TASKS.md spec ✅ all resolved before merge
- `feature/cp13-clone-ready` ✅ branch cut from develop
- Architecture plan ✅ complete for CP13a + CP13b (reviewed, ready to implement)

## Next

- CP13a: userName plumbing (`src/config`, `specialists.ts`, `loop.ts`, `memory_tool.ts`, `cli`)
- CP13b: ntfy parameterisation (`checkpoint.sh`, `admin.ts`, `.env.example`)
- CP13c: `koa setup` wizard
- CP13d: repo sanitisation
- Bump version to `0.3.0` in `package.json` with CP13 release
