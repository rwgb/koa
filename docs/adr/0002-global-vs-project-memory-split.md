# ADR-0002: Global vs. Project-Scoped Memory Databases

## Status
Accepted

## Context
The CP17 spec places all memory in a per-project `~/.koa/projects/<slug>/memory.db`. This made sense when memory was purely code context — journal entries and STATE.md snapshots are inherently project-specific.

With typed learning events, several types are not project-specific: user preferences ("I hate this pattern"), standing orders ("always ask before pushing to prod"), boundaries ("never store X"), and assertions about the user's world ("my server IP is 192.168.1.200"). Storing these in a project database means they are invisible to Koa when working in a different project context.

## Decision
Two SQLite databases with identical schemas:

- `~/.koa/memory.db` — global store for facts true regardless of project context
- `~/.koa/projects/<slug>/memory.db` — project store for project-scoped facts

Global store holds: `preference`, `standing-order`, `boundary`, `assertion`, and `correction` entries that express global behavior rules.

Project store holds: `decision`, `failure`, `resolved`, journal entries, and STATE.md snapshots.

Retrieval queries both databases and merges results via RRF. `correction`, `preference`, `standing-order`, `boundary`, and `assertion` entries default to global unless they contain project-specific content (detected heuristically at write time).

## Consequences
- Preferences and standing orders learned in one project context apply everywhere, as intended.
- Retrieval always queries both databases; the merge adds negligible overhead given SQLite's performance at this scale.
- Schema must be kept in sync between both databases. Migrations run against both on startup.
- Project databases remain self-contained for portability and deletion (e.g. `koa memory forget --project <slug>`).
