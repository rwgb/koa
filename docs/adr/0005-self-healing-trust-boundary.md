# ADR-0005: Self-Healing and Self-Extending Trust Boundary

## Status
Accepted

## Context
Koa is designed to be an autonomous assistant with self-healing (detect and repair failures without user intervention) and self-extending (create new tools when a capability gap is detected) capabilities.

Without a clear trust boundary, a self-healing or self-extending agent could take destructive actions on user systems — misdiagnose a production issue and attempt a "fix," or register auto-generated code that runs with Koa's full permissions.

## Decision
**Trust boundary**: Koa may act unilaterally within its own process boundary. Any action that crosses outside — touching user systems, executing on infrastructure, or persisting new executable code — requires explicit user approval.

**Self-healing scope (unilateral)**:
- Integration re-authentication (expired OAuth tokens, API key rotation)
- Memory database reconciliation (corruption recovery, schema repair)
- Config drift correction (key present in memory but missing from config file)
- Tool quarantine (mark a consistently-failing tool as unavailable, surface a `failure` memory entry)

**Self-healing scope (approval required)**:
- Any action on infrastructure the user owns (servers, databases, cloud resources)
- Any action that modifies files outside Koa's own config directory

**Self-extending**:
- Koa drafts a plugin manifest + implementation to a staging area when a capability gap is detected
- User approval gates registration — no auto-generated code is executed until the user confirms
- Approved plugins run in the existing sandbox (bash subprocess, env-var input only)

## Consequences
- Self-healing for Koa internals is fast and autonomous; no user interruption for routine maintenance.
- User systems are never modified without consent, regardless of what Koa diagnoses.
- Self-extending adds a confirmation step that slightly slows first-use of new capabilities, but prevents hallucinated tools from being silently registered.
- The approval gate pattern already exists in the KOA-PERSONAL-ASSISTANT.md vision doc for high-stakes actions; this decision extends it explicitly to self-modification.
