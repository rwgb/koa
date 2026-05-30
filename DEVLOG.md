# Koa — DevLog

## [2026-05-30] — Project Kickoff

### Completed
- Confirmed Engram skill exists at `~/.claude/skills/engram` (SQLite-backed project memory engine)
- Wired Engram as global auto-hooks in `~/.claude/settings.json`:
  - `SessionStart` → injects goal, masters, hot files at session open
  - `UserPromptSubmit` → surfaces file context when filenames are mentioned
  - `PostToolUse` (Edit|Write|MultiEdit) → silently logs every edit
- Created three bash wrappers at `~/.claude/skills/engram/hooks/auto_*.sh` that pass `$PWD` to the Python hooks at runtime

### Decisions
- **Global hooks via `$PWD` wrappers**: hooks need a static project path at config time; bash wrappers solve this by resolving `$PWD` at execution time. Hooks silently no-op for unindexed projects.
- **Koa = self-built opencode**: this project will be a custom Claude Code-style CLI/agent, with Engram as its memory layer

### Issues Found
- None yet — project not started

### Next Session
- [ ] Define koa's scope: what does it do that `claude` CLI doesn't?
- [ ] Index koa project with Engram once initial structure exists
- [ ] Design koa's architecture (CLI entrypoint, agent loop, Engram integration points)

### Learnings
- Engram brains live at `~/.engram/brains/<slug>/brain.db`
- Engram hooks gracefully exit when no brain exists — safe to enable globally
