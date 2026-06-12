---
written: 2026-06-12
branch: feature/web-console-and-hardening
tests: 837
tsc: clean
tip: 6ad85a8 (voice picker deployed)
---

## Where We Are

Production healthy at 192.168.1.200. Chat routes Anthropic → ClaudeCode fallback (quota exhausted until 2026-07-01). Voice is live in the web console.

### What Was Done This Session

- **Provider fix**: `KOA_PROVIDER=anthropic` on prod; `QuotaFallbackProvider` → ClaudeCode CLI; root cause was `ANTHROPIC_API_KEY` inherited by spawn env. Fixed with `delete spawnEnv['ANTHROPIC_API_KEY']`.
- **Crash fix**: `generateStateDoc`/`generateJournalEntry` now catch all Anthropic errors in `finalize()` — returns placeholder instead of crashing.
- **Deploy fix**: `scripts/deploy.sh` stops service before rsync to prevent ABI mismatch crash window.
- **Voice (CP24)**: Browser-only Web Speech API; optional toggle + voice picker in chat header; defaults off; English voices only; persisted to localStorage.

## Active Branch

`feature/web-console-and-hardening` — all pushed.

## What's Next

1. Ansible hardening (`ansible-galaxy collection install community.general` → run playbooks)
2. Tag v1.0.0
3. Consider Node.js 22 upgrade on production (eliminates better-sqlite3 ABI mismatch)

## Don't Restart

- `undici@8.4.1` incompatible with Node.js 20 — do not re-add.
- Ollama removed from routing (too slow); re-enable via `KOA_PROVIDER=auto` when VM gets more resources.
- Tailscale TLS: requires paid plan.
- `CLAUDE_CODE_TMPDIR=~/.claude/tmp` — set in shell profile to fix ENOSPC.

## Completed Checkpoints

| CP | Label | Status |
|----|-------|--------|
| CP0–CP22 | (see DEVLOG) | done |
| CP23 | Production routing fix | done |
| CP24 | Optional browser TTS + voice picker | done |
