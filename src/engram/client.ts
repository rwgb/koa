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

  private async runWithInput(args: string[], input: string): Promise<string> {
    const result = await execa('python3', [ENGRAM_CLI, ...args], { reject: false, input });
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
      // `status` gives goal and cluster overview
      const statusOut = await this.run(['status', '--project', this.projectPath]);
      const goalMatch = statusOut.match(/^Goal:\s+(.+)$/m);
      const rawGoal = goalMatch?.[1]?.trim();
      const goal = rawGoal && rawGoal !== '(not set)' ? rawGoal : undefined;

      // `session history` gives decisions logged by previous sessions
      const historyOut = await this.run([
        'session', 'history',
        '--project', this.projectPath,
        '--limit', '1',
      ]);
      const decisions: string[] = [];
      for (const line of historyOut.split('\n')) {
        const m = line.match(/^\s+Decision:\s+(.+)$/);
        if (m?.[1]) decisions.push(m[1].trim());
      }
      const sessionSummary = decisions.length > 0 ? decisions.join(' | ') : undefined;

      return {
        ...(goal !== undefined ? { goal } : {}),
        hotFiles: [],      // SpiderBrain handles structural hot-file context
        masterFiles: [],
        ...(sessionSummary !== undefined ? { sessionSummary } : {}),
      };
    } catch {
      return empty;
    }
  }

  async query(terms: string): Promise<string> {
    if (!(await this.checkAvailable())) return '';
    // '--' prevents flag-injection when terms starts with '-'
    return this.run(['query', '--project', this.projectPath, '--', terms]);
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
    // `session remember` is interactive (calls input() for decision/rationale/files).
    // Pipe the answers via stdin: decision=summary, rationale=auto, files=blank.
    const truncated = summary.slice(0, 500).replace(/\n/g, ' ');
    await this.runWithInput(
      ['session', 'remember', '--project', this.projectPath],
      `${truncated}\n(auto-generated)\n\n`,
    );
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
