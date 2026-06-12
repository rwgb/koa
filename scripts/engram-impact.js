#!/usr/bin/env node
// EL-1: Detect breaking changes to the EngramClient public interface.
//
// Exit 0 + {"changed": false}         — no interface changes detected
// Exit 1 + JSON summary               — public interface changed; Engram repo may need update
//
// Usage:
//   node scripts/engram-impact.js
//   node scripts/engram-impact.js --base origin/main --head HEAD

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let base = 'HEAD~1';
let head = 'HEAD';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) { base = args[++i]; continue; }
  if (args[i] === '--head' && args[i + 1]) { head = args[++i]; continue; }
}

// ---------------------------------------------------------------------------
// Fetch diff
// ---------------------------------------------------------------------------

let diff = '';
try {
  diff = execSync(
    `git diff ${base} ${head} -- src/engram/client.ts`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
} catch (err) {
  // git error (e.g. ref does not exist) — treat as no-change so CI doesn't
  // block on shallow clones or new branches with no history.
  process.stdout.write(JSON.stringify({ changed: false, warning: String(err.message) }) + '\n');
  process.exit(0);
}

if (!diff.trim()) {
  process.stdout.write(JSON.stringify({ changed: false }) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Parse diff lines (only additions/removals, ignore context lines)
// ---------------------------------------------------------------------------

const added = [];
const removed = [];

for (const line of diff.split('\n')) {
  if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
  if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1));
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

// Matches public method signatures:
//   async sync(): Promise<void>
//   query(terms: string): Promise<string>
//   buildSystemPromptInjection(ctx: EngramContext): string
//   autoIndex(): Promise<void>
const PUBLIC_METHOD_RE =
  /^\s{2}(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:\s*(.+?)\s*[{;]?\s*$/;

// Matches exported type/interface declarations
const EXPORTED_TYPE_RE = /^\s*export\s+(?:type|interface)\s+([a-zA-Z][a-zA-Z0-9_]*)/;

// Matches constructor signature
const CONSTRUCTOR_RE = /^\s{2}constructor\s*\(([^)]*)\)/;

function extractSignatures(lines) {
  const methods = new Map();   // name → { params, returnType }
  const types = new Set();
  let constructorSig = null;

  for (const line of lines) {
    const mMethod = line.match(PUBLIC_METHOD_RE);
    if (mMethod) {
      const [, name, params, ret] = mMethod;
      // Skip private helpers (checkAvailable, brainExists, run, runWithInput)
      if (!line.trimStart().startsWith('private') && !line.trimStart().startsWith('async p')) {
        methods.set(name, { params: params.trim(), returnType: ret.trim() });
      }
    }

    const mType = line.match(EXPORTED_TYPE_RE);
    if (mType) types.add(mType[1]);

    const mCtor = line.match(CONSTRUCTOR_RE);
    if (mCtor) constructorSig = mCtor[1].trim();
  }

  return { methods, types, constructorSig };
}

// Also detect: "private" keyword removed from a method (visibility change)
const VISIBILITY_CHANGE_RE = /^\s{2}private\s+(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/;

function extractPrivate(lines) {
  const names = new Set();
  for (const line of lines) {
    const m = line.match(VISIBILITY_CHANGE_RE);
    if (m) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const before = extractSignatures(removed);
const after  = extractSignatures(added);

const changedMethods = [];
const addedMethods   = [];
const removedMethods = [];

for (const [name, sig] of after.methods) {
  if (!before.methods.has(name)) {
    addedMethods.push({ name, ...sig });
  } else {
    const prev = before.methods.get(name);
    if (prev.params !== sig.params || prev.returnType !== sig.returnType) {
      changedMethods.push({ name, before: prev, after: sig });
    }
  }
}

for (const [name, sig] of before.methods) {
  if (!after.methods.has(name)) {
    removedMethods.push({ name, ...sig });
  }
}

// Types added/removed
const addedTypes   = [...after.types].filter(t => !before.types.has(t));
const removedTypes = [...before.types].filter(t => !after.types.has(t));

// Constructor change
let constructorChanged = false;
if (before.constructorSig !== null || after.constructorSig !== null) {
  constructorChanged = before.constructorSig !== after.constructorSig;
}

// Visibility changes: private removed (method became public)
const prevPrivate = extractPrivate(removed);
const nextPrivate = extractPrivate(added);
const visibilityChanges = [];
for (const name of prevPrivate) {
  if (!nextPrivate.has(name)) visibilityChanges.push({ name, change: 'private→public' });
}
for (const name of nextPrivate) {
  if (!prevPrivate.has(name)) visibilityChanges.push({ name, change: 'public→private' });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const hasChanges =
  changedMethods.length > 0 ||
  removedMethods.length > 0 ||
  addedMethods.length > 0 ||
  addedTypes.length > 0 ||
  removedTypes.length > 0 ||
  constructorChanged ||
  visibilityChanges.length > 0;

if (!hasChanges) {
  process.stdout.write(JSON.stringify({ changed: false }) + '\n');
  process.exit(0);
}

const summary = {
  changed: true,
  ...(changedMethods.length  > 0 ? { changedMethods }  : {}),
  ...(removedMethods.length  > 0 ? { removedMethods }  : {}),
  ...(addedMethods.length    > 0 ? { addedMethods }    : {}),
  ...(addedTypes.length      > 0 ? { addedTypes }      : {}),
  ...(removedTypes.length    > 0 ? { removedTypes }    : {}),
  ...(constructorChanged         ? { constructorChanged, constructorBefore: before.constructorSig, constructorAfter: after.constructorSig } : {}),
  ...(visibilityChanges.length > 0 ? { visibilityChanges } : {}),
};

process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.exit(1);
