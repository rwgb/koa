import fs from 'fs';
import path from 'path';
import os from 'os';
import type Anthropic from '@anthropic-ai/sdk';
import { MODEL_MAP } from '../types/index.js';

export interface Preference {
  id: string;
  text: string;
  createdAt: string;
}

function prefsPath(): string {
  const home = process.env['KOA_HOME'] ?? os.homedir();
  return path.join(home, '.koa', 'preferences.json');
}

export function loadPreferences(): Preference[] {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as Preference[];
  } catch {
    // file missing or malformed
  }
  return [];
}

export function savePreferences(prefs: Preference[]): void {
  const p = prefsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), { mode: 0o600 });
}

export function buildPreferencesBlock(prefs: Preference[]): string {
  if (prefs.length === 0) return '';
  const list = prefs.map((p) => `- ${p.text}`).join('\n');
  return `<user_preferences>\n${list}\n</user_preferences>`;
}

/**
 * Extracts explicit preference statements from a conversation turn and persists
 * any new ones. Fire-and-forget safe — non-fatal on extraction failure.
 */
export async function extractAndMergePreferences(
  userMsg: string,
  assistantMsg: string,
  existing: Preference[],
  client: Anthropic,
): Promise<void> {
  if (!userMsg.trim()) return;

  const existingTexts = existing.map((p) => p.text).join('\n');
  const prompt = `Analyze this conversation exchange and extract explicit user preferences.

Extract ONLY explicit statements like "I prefer X", "always Y", "never Z", "I like X", "don't do Y", "use X format".
Do NOT infer preferences — only extract direct, explicit statements.
Do NOT duplicate items already in the known preferences list below.

Known preferences:
${existingTexts || '(none)'}

User: ${userMsg.slice(0, 500)}
Assistant: ${assistantMsg.slice(0, 200)}

Return a JSON array of new preference strings (max 80 chars each), or [] if none. JSON only.`;

  let extracted: unknown;
  try {
    const response = await client.messages.create({
      // tier: fast — preference extraction (internal, non-user-facing)
      model: MODEL_MAP.fast,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    extracted = JSON.parse(match?.[0] ?? '[]');
  } catch {
    return;
  }

  if (!Array.isArray(extracted) || extracted.length === 0) return;

  const now = new Date().toISOString();
  const newPrefs: Preference[] = (extracted as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((text) => ({
      id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: text.trim().slice(0, 80),
      createdAt: now,
    }));

  if (newPrefs.length > 0) {
    savePreferences([...existing, ...newPrefs]);
  }
}
