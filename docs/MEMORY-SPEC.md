# CP17 — Long-Term Memory: Tiered Retention + Hybrid Retrieval

Status: APPROVED — decision flags D1–D4 resolved 2026-06-10 (see §11)
Author: spec drafted 2026-06-10
Branch (proposed): `feature/cp17-longterm-memory` (from `develop`, after FABLE_AUDIT fixes merge — D4)

## 1. Problem

Koa's memory layers hold per-turn token cost constant by discarding data: user facts roll
off at 200 (`src/memory/store.ts:40-42`), journals older than 3 days are invisible
(`src/agent/loop.ts:249`), Engram session history is truncated to 200 chars at write time
(`src/agent/loop.ts:941`) and capped again at 500 inside `rememberSession`
(`src/engram/client.ts:124`), and only the single most recent session is ever read back
(`src/engram/client.ts:59`). Recall coverage shrinks as the corpus grows, with no signal
when something falls outside a window (`'poor-recall'` is defined in
`src/engram/signals.ts` but never emitted).

CP17 replaces window-based forgetting with **retrieval over a 180-day episodic corpus plus
a permanent consolidated-facts tier**, decoupling corpus size from per-turn token cost.

## 2. Goals

1. Any conversation, decision, or preference from the last 180 days is recallable per-turn
   via semantic + keyword retrieval, at ≤ ~2 KB of injected context.
2. Durable knowledge (decisions, preferences, constraints) survives past 180 days via
   consolidation into a permanent facts tier.
3. Recall latency ≤ 150 ms p95 per turn, fully local (no new network dependencies on
   Anthropic; Anthropic has no embeddings API — do not add a third-party embeddings SaaS).
4. Graceful degradation: with Ollama unavailable, retrieval falls back to keyword-only
   (FTS5/BM25). With the DB missing, behavior is identical to today. Same fail-soft
   pattern as `EngramClient.checkAvailable`.
5. Emit `'poor-recall'` when retrieval returns nothing above threshold — close the
   observability gap.

## 3. Non-Goals

- Replacing PROJECT.md / STATE.md / HANDOFF.md as human-readable sources of truth. The
  index is a **derived, disposable cache**; markdown remains canonical.
- Replacing SpiderBrain (structural code graph) or Engram's goal/sync features. Engram's
  *keyword query* path becomes redundant and is marked for deprecation (stretch, §10).
- Cross-project memory sharing.
- Changing the 200-fact `memory.json` injection in v1 (small, always-relevant, prompt-
  cached). Revisit after v1 telemetry (open decision D3).

## 4. Architecture

### 4.1 Tiers

| Tier | Content | Retention | Store |
|------|---------|-----------|-------|
| Working | PROJECT.md, STATE.md, HANDOFF.md, today's journal | regenerated / session | markdown (unchanged) |
| Episodic | journal entries, session decisions, STATE.md snapshots | **180-day rolling** (configurable) | `memory.db` chunks |
| Semantic | consolidated durable facts + user `remember` facts | permanent | `memory.db` facts + `memory.json` |

### 4.2 Storage

New per-project SQLite DB: `~/.koa/projects/<slug>-<hash>/memory.db` (mode 0600, same
dir as existing markdown — `projectMemoryPaths()` gains a `memoryDb` entry).

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,            -- verbatim chunk text
  source TEXT NOT NULL,             -- 'journal' | 'state' | 'session' | 'handoff'
  source_ref TEXT,                  -- e.g. journal filename + entry heading
  created_at TEXT NOT NULL,         -- ISO 8601
  content_hash TEXT NOT NULL UNIQUE,-- sha256; makes ingestion idempotent
  consolidated INTEGER DEFAULT 0    -- 1 after consolidation pass has seen it
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content='chunks', content_rowid='id');
CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[768]);  -- sqlite-vec
CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  fact TEXT NOT NULL,
  category TEXT,                    -- 'decision' | 'preference' | 'constraint' | 'lesson'
  derived_from TEXT,                -- chunk ids, for provenance
  created_at TEXT NOT NULL
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- schema_version, last_sweep
```

`chunks_vec` rowids mirror `chunks.id`. A chunk without an embedding row (Ollama was
down at ingest) is still keyword-searchable; a background re-embed pass fills gaps.

### 4.3 Embeddings

- Provider: existing Ollama integration (CP12c/CP14c VM), `POST /api/embed`, model
  `nomic-embed-text` (768-dim). New `embed(texts: string[])` method on the Ollama
  client (`src/agent/providers/ollama.ts` currently has no embed support).
- No Ollama → skip embedding, retrieval runs FTS-only. Never block a turn on embedding
  availability.

### 4.4 Ingestion (write path)

Hook: end of `finalize()` (`src/agent/loop.ts:899`) and `checkpoint()`
(`src/agent/loop.ts:889`), after the markdown writes — markdown stays canonical, index
derives from it.

- **Journal entries**: one chunk per entry (the `## <date> <time>` block, including the
  verbatim `**User said:**` list). Entries are 100–300 words — natural chunk size; no
  sub-splitting in v1.
- **Session decisions**: the full untruncated `buildConversationSummary()` decision
  content as a `'session'` chunk. This is the fix for the 200/500-char truncation —
  Engram's `rememberSession` keeps its short string (its schema is fixed), but the full
  text now lands in `memory.db`.
- **STATE.md snapshots**: on each regeneration, ingest the *outgoing* STATE.md as a
  `'state'` chunk before overwrite (decisions in "Decided This Session" / "What Didn't
  Work" sections are otherwise lost on rewrite).
- Idempotent by `content_hash`; re-running ingestion is a no-op.

### 4.5 Retrieval (read path)

Hook: `buildSystemBlocks()` (`src/agent/loop.ts:330`).

- Block 2 change: `<recent_sessions>` shrinks from 3 journals to **today's journal only**
  (continuity within the day, stays cache-stable).
- Block 3 addition: `<recalled_memory>` — top-k chunks for the current user message.
  - Embed user message (local, ~30–80 ms) → vector top-20 ∥ FTS/BM25 top-20 →
    **reciprocal rank fusion** → top 6 chunks, hard budget ~2 KB.
  - Each chunk rendered with its date and source: the model must see *when* a memory is
    from to weigh staleness.
  - Score floor: if best fused score < threshold, inject nothing and emit
    `'poor-recall'` via `emitSignal` (now actually wired).
- `recall` tool (new): explicit agent-invoked search over chunks + facts, mirroring
  `engram_query`'s shape, for "what did we decide about X months ago" follow-ups beyond
  the auto-injected top-k.
- Facts tier: `facts` rows are appended to the `<user_memories>` block alongside
  `memory.json` facts (they are few and durable; whole-injection is correct for them).
  If combined count exceeds ~300, switch facts to retrieval (open decision D3).

### 4.6 Consolidation + retention sweep

Runs inside `finalize()` at most once per 7 days (`meta.last_sweep`), fire-and-forget
like `autoMolt` — never blocks shutdown longer than a 10 s `Promise.race`, same pattern
as PROJECT.md generation (`src/agent/loop.ts:916-921`).

1. Select chunks with `consolidated = 0` and age > `retentionDays - 14` (grace window).
2. Batch to Haiku (reuse `MODELS.haiku` pattern from
   `src/project-memory/generators/state-doc.ts`): *"Extract only durably-true facts —
   decisions with rationale, user preferences, constraints, lessons. Output nothing if
   none."* Distill, don't blur: each fact must be specific and self-contained.
3. Insert into `facts` with provenance; mark chunks `consolidated = 1`.
4. Delete chunks (and their fts/vec rows) older than `retentionDays`.
5. No API key at sweep time → skip consolidation, **defer deletion** (never delete
   unconsolidated history; retention can exceed 180d until a keyed session runs).

### 4.7 Config

`memory` section in koa config (`src/config/index.ts`):

```jsonc
{
  "memory": {
    "retentionDays": 180,        // 0 = never expire episodic chunks
    "recallTopK": 6,
    "embedModel": "nomic-embed-text"
  }
}
```

### 4.8 Backfill

New CLI: `koa memory index` — walks all existing `journal/*.md` (well beyond the 3-day
window) + current STATE.md and ingests them. Idempotent. Run once at upgrade; also
`koa memory status` (chunk/fact counts, embedding coverage, last sweep) and
`koa memory sweep --dry-run`.

## 5. Performance Budget

| Path | Budget | Notes |
|------|--------|-------|
| initialize() | +0 ms blocking | DB opened lazily on first recall/ingest |
| per-turn recall | ≤ 150 ms p95 | ~30–80 ms local embed + <10 ms query (brute-force vec over ≤ ~5k chunks is single-digit ms; revisit ANN only if corpus exceeds ~50k) |
| finalize() ingest | ≤ 1 s | a handful of inserts + one embed batch |
| sweep | fire-and-forget | ≤ 1 Haiku call per batch of ~20 chunks |

## 6. Dependencies

- `sqlite-vec` (npm, native extension — pin exact version, note in security review)
- SQLite driver: `better-sqlite3` vs `node:sqlite` — **DECISION FLAG D1**, see §11
- No new network services; Ollama reuse only

## 7. Testing

- Unit: chunker (journal entry boundaries), content-hash idempotency, RRF merge order,
  retention sweep with injected clock, consolidation skip-without-key path, score-floor
  → `'poor-recall'` emission.
- Integration: FTS-only mode (no Ollama in CI — mirror how Engram tests stub
  availability); end-to-end ingest → recall round-trip with a fake embed function.
- Regression: existing 653 tests stay green; `buildSystemBlocks` block-shape tests
  updated for the new `<recalled_memory>` block and 1-journal block 2.

## 8. Security Review Notes (pipeline gate)

- `memory.db` mode 0600, matching `memory.json` (`src/memory/store.ts:30`).
- Chunks may contain secrets a user pasted in chat — same exposure class as today's
  journals, but retention extends it to 180 days. Add `koa memory forget <term>` (CLI +
  tool) deleting matching chunks/facts, parallel to `removeMemory`.
- All SQL via prepared statements; user message text is a parameter, never interpolated.
- `sqlite-vec` is a native module: pin version, verify checksum in lockfile, flag in
  security-review skill run.
- Recalled chunks are model-read markdown — do not XML-escape content (same rationale as
  the journal comment at `src/agent/loop.ts:357-358`), but wrap per-chunk in delimiters
  so injected history can't masquerade as system instructions.

## 9. Implementation Phases (maps to §15 pipeline gates)

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| 0 | Write-side fidelity: untruncated session chunk at finalize; STATE.md snapshot-before-overwrite | full decision text present in DB after a session |
| 1 | `memory.db` store + Ollama `embed()` + ingestion + backfill CLI | `koa memory index` + `status` work; idempotent re-run |
| 2 | Retrieval: RRF query, `<recalled_memory>` injection, `recall` tool, `'poor-recall'` wiring | 180-day-old planted memory recalled in a live session; p95 budget met |
| 3 | Consolidation + retention sweep + `koa memory sweep` | facts promoted before expiry; deletion deferred without key |
| 4 (stretch) | Deprecate `engram_query` in favor of `recall`; remove 3-journal read | — |

Each phase is a reviewable commit; full pipeline (Arch → QA → Security → Docs) runs on
the branch before the CP17 checkpoint fires. UI/UX gate: skipped (no UI surface; note
skip in DEVLOG) unless the web console gains a memory inspector (out of scope).

## 10. Future Work (explicitly deferred)

- In-process replacement of Engram keyword query (Phase 4 stretch).
- Web console memory inspector (browse/edit facts, view recall hits per turn).
- Retrieval-gated `memory.json` once fact count warrants it (D3).
- Cross-encoder re-ranking — only if RRF quality proves insufficient in practice.

## 11. Open Decisions (resolve before Phase 1)

- **D1 — SQLite driver**: `better-sqlite3` (mature, sync API, ABI rebuilds on Node
  upgrades) vs `node:sqlite` (no native dep, but verify the project's Node floor
  supports it and that sqlite-vec extension loading works with it). Default
  recommendation: `better-sqlite3` — sqlite-vec's npm docs target it.
- **D2 — Embedding model**: `nomic-embed-text` assumed; confirm it's pulled on the
  Ollama VM (CP14c) and benchmark embed latency over Tailscale vs localhost. If VM
  round-trip exceeds ~100 ms, prefer a local ollama install for embeds only.
- **D3 — memory.json under retrieval**: keep whole-injection (cached, 200-cap) for v1;
  revisit when `facts` + memories exceed ~300 entries.
- **D4 — Sequencing vs FABLE_AUDIT_FIXES**: audit remediation (HANDOFF "What's Next" #1)
  touches `loop.ts` (dead `maybeCompact`). Apply audit fixes first to avoid conflicting
  edits in the same file. CP17 starts from `develop` after audit fixes merge.
