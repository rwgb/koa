import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers — exercise the doctor logic directly without Commander CLI parsing.
// We extract the core logic into a testable function by mirroring what the
// action handler does so tests don't need to spawn a child process.
// ---------------------------------------------------------------------------

interface DoctorIssue {
  field: string;
  description: string;
  fix: (cfg: Record<string, unknown>) => void;
}

function detectIssues(raw: Record<string, unknown>): DoctorIssue[] {
  const issues: DoctorIssue[] = [];

  if ('smartRouting' in raw) {
    issues.push({
      field: 'smartRouting',
      description:
        raw['smartRouting'] === true
          ? 'smartRouting: true — migrate to provider: "auto"'
          : 'smartRouting field is obsolete — removing',
      fix: (cfg) => {
        if (cfg['smartRouting'] === true && !('provider' in cfg)) cfg['provider'] = 'auto';
        delete cfg['smartRouting'];
      },
    });
  }
  if ('compactAfterTurns' in raw) {
    issues.push({
      field: 'compactAfterTurns',
      description: 'compactAfterTurns is a dead config field — removing',
      fix: (cfg) => {
        delete cfg['compactAfterTurns'];
      },
    });
  }

  return issues;
}

function applyFixes(
  configPath: string,
  raw: Record<string, unknown>,
  issues: DoctorIssue[],
): void {
  const backup = configPath + '.bak';
  fs.copyFileSync(configPath, backup);
  const updated = { ...raw };
  for (const issue of issues) issue.fix(updated);
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-doctor-test-'));
  const koaDir = path.join(tmpDir, '.koa');
  fs.mkdirSync(koaDir, { recursive: true });
  configPath = path.join(koaDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('koa doctor', () => {
  it('reports no issues for a clean config', () => {
    const clean = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
    fs.writeFileSync(configPath, JSON.stringify(clean));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);
    expect(issues).toHaveLength(0);
  });

  it('detects smartRouting: true as an issue', () => {
    const cfg = { smartRouting: true };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('smartRouting');
    expect(issues[0]!.description).toMatch(/migrate to provider/);
  });

  it('detects compactAfterTurns as an issue', () => {
    const cfg = { compactAfterTurns: 10 };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('compactAfterTurns');
    expect(issues[0]!.description).toMatch(/dead config field/);
  });

  it('--fix migrates smartRouting: true to provider: auto and removes the field', () => {
    const cfg = { smartRouting: true, model: 'claude-haiku-4-5-20251001' };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);

    applyFixes(configPath, raw, issues);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect('smartRouting' in updated).toBe(false);
    expect(updated['provider']).toBe('auto');
  });

  it('--fix does not overwrite an existing provider when smartRouting: true', () => {
    const cfg = { smartRouting: true, provider: 'ollama' };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);

    applyFixes(configPath, raw, issues);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect('smartRouting' in updated).toBe(false);
    // Pre-existing provider must be preserved — the fix only sets provider when absent.
    expect(updated['provider']).toBe('ollama');
  });

  it('--fix removes compactAfterTurns', () => {
    const cfg = { compactAfterTurns: 5, model: 'claude-haiku-4-5-20251001' };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);

    applyFixes(configPath, raw, issues);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect('compactAfterTurns' in updated).toBe(false);
    expect(updated['model']).toBe('claude-haiku-4-5-20251001');
  });

  it('--fix writes a backup file before modifying', () => {
    const cfg = { smartRouting: false };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const issues = detectIssues(raw);

    applyFixes(configPath, raw, issues);

    const backupPath = configPath + '.bak';
    expect(fs.existsSync(backupPath)).toBe(true);
    // Backup must contain the original content (before fix).
    const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as Record<string, unknown>;
    expect(backupContent['smartRouting']).toBe(false);
  });
});
