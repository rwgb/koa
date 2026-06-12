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

## Current State (2026-06-11)

- Branch: `feature/web-console-and-hardening`
- CP20 done: all 11 HIGH/MEDIUM audit findings fixed, 3 LOW carry-ins fixed, api-cost-optimization phases 1–3 and smart-routing hybrid classifier implemented
- CHANGELOG.md "Fixed" claims verified accurate — no audit blockers remain for the v1.0.0 tag
- Hard deadline: koa stable (no iOS/watchOS) before 2026-06-29

## Current Arc — CP13: Clone-Ready Hardening (complete)

- CP13a–CP13d ✅ all done on `feature/cp13-clone-ready`
- PR #4 (docs sync) ✅ merged to main 2026-06-05
- Gate grep: zero hits ✅
- tsc clean, 619 tests passing ✅
- Security review: clean ✅

## Infra Recovery (2026-06-08, in-progress)

- Packer rewritten: `proxmox-iso` → `proxmox-clone` from VMID 100 (existing Debian 13 template, `debian:debian`)
- Packer build running — clone + Ollama install (~5 min vs 40 min); will produce template at VMID 9001
- Koa web console deployed to LXC 200 ✅ — http://192.168.1.200:3000 live
- Fixed: deploy.sh (sudo, native rebuild), koa.service (namespace hardening), rsync missing on LXC

## Next

- [ ] Confirm Packer build succeeded; `terraform apply` → VM 201 (you run: `cd infra && terraform apply`)
- [ ] Verify 192.168.1.201 + `ollama list`
- [ ] PR: `feature/cp13-clone-ready` → `develop` → release v0.3.0
- [ ] CP14: Smart model routing (Ollama/Anthropic/Claude-Code providers) + fix `PUT /integrations/:id` ntfy topic validation
