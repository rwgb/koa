# Koa — Project Instructions

At session start, read `memory/HANDOFF.md` first. It is authoritative for current state.
Skip DEVLOG.md unless you need detailed history.

This project follows the global CLAUDE.md pipeline gates (§15), checkpoint routine (§16), and workflow-first execution (§19).
Checkpoint notifications go to ntfy topic configured in ~/.koa/credentials.

Multi-step implementation work (audit remediations, CP implementations) must use the `Workflow` tool with pipeline gates (tsc + vitest + security-review) baked into the workflow phases — not run manually after the fact.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `rwgb/koa`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
