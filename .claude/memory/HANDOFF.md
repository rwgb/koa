---
written: 2026-06-12
branch: feature/web-console-and-hardening
tests: 837
tsc: clean
tip: 3 commits pushed (bfd7305)
---

## Where We Are

Production chat working on 192.168.1.200 via **QuotaFallbackProvider**: Anthropic tries first (quota exhausted until 2026-07-01) → falls back to ClaudeCode CLI subscription. Auto-titling and conversation naming verified working.

### What Was Fixed This Session

- **Root cause of ClaudeCode exit 1**: `ClaudeCodeProvider.doRun()` inherited `ANTHROPIC_API_KEY` from service env → claude used exhausted API key instead of `~/.claude.json`. Fixed by stripping the key before spawn.
- **Service crash on shutdown**: `generateStateDoc` / `generateJournalEntry` threw unhandled in `finalize()` when Anthropic quota hit. Fixed with try/catch (returns placeholder on failure).
- **better-sqlite3 ABI mismatch**: `scripts/deploy.sh` now stops service before rsync to prevent crash window during node_modules sync.
- **Provider routing**: Production `KOA_PROVIDER=anthropic` (was `ollama`). QuotaFallbackProvider handles routing automatically.

### Production State

- `/etc/koa/env` → `KOA_PROVIDER=anthropic`
- `/home/koa/.claude.json` → valid Claude subscription credentials (koa user)
- `node_modules/better-sqlite3` → rebuilt for Node.js v20.20.2 on production
- Service: active (running), no crash loop

## Active Branch

`feature/web-console-and-hardening` — all changes committed and pushed.

## What's Next

1. Verify web voice component works in browser at 192.168.1.200
2. Run Ansible hardening playbooks: `ansible-galaxy collection install community.general` then run playbooks
3. Tag v1.0.0
4. Consider upgrading production to Node.js 22 to eliminate the ABI mismatch permanently

## Don't Restart

- Tried undici@8.4.1 for Ollama timeout fix: incompatible with Node.js 20. Reverted.
- Ollama removed from routing for now (too slow for 7B model); re-enable via `KOA_PROVIDER=auto` when VM gets more resources.
- Tried Tailscale TLS certs: requires paid plan.
- iOS real-device test via Tailscale: deferred.
- `CLAUDE_CODE_TMPDIR`: set `CLAUDE_CODE_TMPDIR=~/.claude/tmp` in shell profile to fix ENOSPC.

## Completed Checkpoints (reference)

| CP | Label | Status |
|----|-------|--------|
| CP0–CP21 | (see DEVLOG for history) | done |
| Hotfix | Chat transcript persistence | done |
| CP22 | Production hardening: updater, TTS, web voice, Ansible | done |
| CP23 | Production routing: ClaudeCode fallback, crash fixes | done |
