import { execa } from 'execa';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { EngramContext } from '../types/index.js';
import { ENGRAM_CLI } from '../config/index.js';

export class EngramClient {
  private projectPath: string;
  private available: boolean | null = null;
  private _indexPromise?: Promise<void>;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  private async checkAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    this.available = fs.existsSync(ENGRAM_CLI) && this.brainExists();
    return this.available;
  }

  private brainExists(): boolean {
    const slug = this.projectPath
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const brainPath = path.join(os.homedir(), '.engram', 'brains', slug, 'brain.db');
    return fs.existsSync(brainPath);
  }

  private async run(args: string[]): Promise<string> {
    const result = await execa('python3', [ENGRAM_CLI, ...args], { reject: false });
    return result.stdout ?? '';
  }

  async sync(): Promise<void> {
    if (!(await this.checkAvailable())) return;
    await this.run(['sync', this.projectPath]);
  }

  async getContext(): Promise<EngramContext> {
    const empty: EngramContext = { hotFiles: [], masterFiles: [] };
    if (!(await this.checkAvailable())) return empty;

    try {
      const raw = await this.run(['context', '--project', this.projectPath, '--json']);
      const parsed = JSON.parse(raw) as {
        goal?: string;
        hot_files?: Array<{ path: string; score: number; cluster?: string }>;
        masters?: string[];
        session_summary?: string;
      };

      return {
        ...(parsed.goal !== undefined ? { goal: parsed.goal } : {}),
        hotFiles: (parsed.hot_files ?? []).map((f) => ({
          path: f.path,
          score: f.score,
          ...(f.cluster !== undefined ? { cluster: f.cluster } : {}),
        })),
        masterFiles: parsed.masters ?? [],
        ...(parsed.session_summary !== undefined ? { sessionSummary: parsed.session_summary } : {}),
      };
    } catch {
      return empty;
    }
  }

  async query(terms: string): Promise<string> {
    if (!(await this.checkAvailable())) return '';
    // '--' prevents flag-injection if `terms` starts with '-'
    return this.run(['query', '--', terms, '--project', this.projectPath]);
  }

  async startSession(goal?: string): Promise<void> {
    if (!(await this.checkAvailable())) return;
    const args = ['session', 'start', '--project', this.projectPath];
    if (goal) args.push('--goal', '--', goal);
    await this.run(args);
  }

  autoIndex(): Promise<void> {
    if (this._indexPromise) return this._indexPromise;
    if (!fs.existsSync(ENGRAM_CLI)) return Promise.resolve();
    if (this.brainExists()) return Promise.resolve();

    process.stderr.write('[Engram] auto-index started\n');
    this._indexPromise = this.sync()
      .then(() => { process.stderr.write('[Engram] auto-index complete\n'); })
      .catch((err: unknown) => {
        process.stderr.write(
          `[Engram] auto-index failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });

    return this._indexPromise;
  }

  async rememberSession(summary: string): Promise<void> {
    if (!(await this.checkAvailable())) return;
    await this.run(['session', 'remember', '--project', this.projectPath, '--summary', '--', summary]);
  }

  buildSystemPromptInjection(ctx: EngramContext): string {
    const parts: string[] = [];

    if (ctx.goal) {
      parts.push(`## Session Goal\n${ctx.goal}`);
    }

    if (ctx.hotFiles.length > 0) {
      const list = ctx.hotFiles
        .slice(0, 10)
        .map((f) => `- ${f.path}${f.cluster ? ` [${f.cluster}]` : ''}`)
        .join('\n');
      parts.push(`## Hot Files (most relevant to this project)\n${list}`);
    }

    if (ctx.masterFiles.length > 0) {
      parts.push(`## Key Files\n${ctx.masterFiles.map((f) => `- ${f}`).join('\n')}`);
    }

    if (ctx.sessionSummary) {
      parts.push(`## Previous Session\n${ctx.sessionSummary}`);
    }

    return parts.length > 0 ? `<engram_context>\n${parts.join('\n\n')}\n</engram_context>` : '';
  }
}
