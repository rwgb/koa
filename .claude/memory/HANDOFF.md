---
written: 2026-06-12
branch: feature/web-console-and-hardening
tests: 837
tsc: clean
tip: uncommitted working tree (production hardening session)
---

## Where We Are

Production hardening complete. Chat working on 192.168.1.200 via Ollama primary + ClaudeCode CLI fallback.

- **Production fix**: `KOA_PROVIDER=ollama` added to `/etc/koa/env`; Claude Code credentials deployed to `/home/koa/.claude.json` for fallback auth. Service restarted and confirmed healthy.
- **Updater**: Hard-coded `origin`/`main`/`https://github.com/rwgb/koa.git`; graceful fallback when no upstream; `GITHUB_PAT` support in fetch URL.
- **TTS**: `'none'` provider added; OS-aware default (linux→none, darwin→say); no-op on server side.
- **Web voice**: `useSpeech` hook in `web/src/hooks/useSpeech.ts` — auto-speaks Koa responses on `done` event; server TTS when available, Web Speech API when provider is `'none'`.
- **Installer**: GitHub PAT prompt, OS-aware TTS config, upstream tracking.
- **Ansible**: `infra/ansible/` with `inventory.yml`, `playbook-koa-lxc.yml`, `playbook-ollama-vm.yml`.

## Active Branch

`feature/web-console-and-hardening` — production hardening changes uncommitted.

## What's Next

1. Commit this session's changes (atomic commits) + open PR
2. Deploy to production: `git push` → SSH pull/rebuild on 192.168.1.200
3. Verify web voice in browser at 192.168.1.200
4. Tag v1.0.0
5. Install Ansible collection before running playbooks: `ansible-galaxy collection install community.general`

## Open Questions

(none)

## Don't Restart

- Tried Tailscale TLS certs: requires paid plan. HTTP over WireGuard is sufficient.
- Tried setInterval for briefing at 08:00: deferred to CP10e.
- iOS real-device test via Tailscale: deferred indefinitely.
- `CLAUDE_CODE_TMPDIR`: session sandbox fills up on large piped commands; set `CLAUDE_CODE_TMPDIR=~/.claude/tmp` in shell profile before next session.

## Completed Checkpoints (reference)

| CP | Label | Status |
|----|-------|--------|
| CP0–CP21 | (see DEVLOG for history) | done |
| Hotfix | Chat transcript persistence | done |
| CP22 | Production hardening: updater, TTS, web voice, Ansible | done |
