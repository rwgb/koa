import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  loadPreferences,
  savePreferences,
  buildPreferencesBlock,
  type Preference,
} from '../engram/preferences.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-prefs-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('loadPreferences', () => {
  it('returns empty array when file does not exist', () => {
    expect(loadPreferences()).toEqual([]);
  });

  it('returns empty array when file is malformed', () => {
    const koaDir = path.join(tempDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(path.join(koaDir, 'preferences.json'), 'not json');
    expect(loadPreferences()).toEqual([]);
  });
});

describe('savePreferences / loadPreferences round-trip', () => {
  it('persists and reloads preferences', () => {
    const prefs: Preference[] = [
      { id: 'pref_1', text: 'User prefers concise responses', createdAt: '2026-06-01T00:00:00Z' },
      { id: 'pref_2', text: 'User likes code examples', createdAt: '2026-06-01T00:00:00Z' },
    ];
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it('creates .koa directory if missing', () => {
    const prefs: Preference[] = [
      { id: 'p1', text: 'test pref', createdAt: '2026-06-01T00:00:00Z' },
    ];
    savePreferences(prefs);
    expect(fs.existsSync(path.join(tempDir, '.koa', 'preferences.json'))).toBe(true);
  });
});

describe('buildPreferencesBlock', () => {
  it('returns empty string for no preferences', () => {
    expect(buildPreferencesBlock([])).toBe('');
  });

  it('formats preferences as XML block', () => {
    const prefs: Preference[] = [
      { id: 'p1', text: 'User prefers short answers', createdAt: '2026-06-01T00:00:00Z' },
      { id: 'p2', text: 'Always use TypeScript', createdAt: '2026-06-01T00:00:00Z' },
    ];
    const block = buildPreferencesBlock(prefs);
    expect(block).toContain('<user_preferences>');
    expect(block).toContain('- User prefers short answers');
    expect(block).toContain('- Always use TypeScript');
    expect(block).toContain('</user_preferences>');
  });
});
