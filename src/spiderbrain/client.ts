import { execa } from 'execa';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { SpiderBrainContext, SpiderBrainMaster } from '../types/index.js';

const SCRIPTS_DIR = path.join(os.homedir(), '.claude', 'skills', 'spiderbrain', 'core', 'scripts');
const MAX_OUTPUT_CHARS = 8000;
// Safe node ID: no whitespace or shell metacharacters, and no path traversal via ".."
const SAFE_NODE_ID = /^[^\s;&|$`<>"']+$/;
const MAX_QUERY_TERMS_CHARS = 500;

/** Escape XML special characters so synganglion data cannot break out of XML tags in the system prompt. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface SynganglionNode {
  webscore?: number;
  webscoreAuto?: number;
  lastChangedAt?: string;
  cluster?: string;
  role?: string;
  cell?: string;
  dependedOnBy?: string[];
  dependsOn?: string[];
}

interface SynganglionCluster {
  webscore?: number;
  nodeCount: number;
  title?: string;
  topNodes: string[];
}

interface Synganglion {
  prey: string;
  nodes: Record<string, SynganglionNode>;
  clusters: Record<string, SynganglionCluster>;
}

export class SpiderBrainClient {
  private brainDir: string | null;
  private projectPath: string;

  constructor(projectPath: string, brainDirOverride?: string) {
    this.projectPath = projectPath;
    this.brainDir = brainDirOverride ?? this.detectBrainDir();
  }

  private detectBrainDir(): string | null {
    const parent = path.dirname(this.projectPath);
    const name = path.basename(this.projectPath);
    const candidate = path.join(parent, `${name}-spiderbrain`);
    try {
      fs.accessSync(path.join(candidate, 'synganglion.json'));
      return candidate;
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.brainDir !== null;
  }

  async getContext(): Promise<SpiderBrainContext> {
    if (!this.brainDir) {
      return { available: false, prey: '', masters: [], hotFiles: [], clusterNames: [] };
    }

    const graph = JSON.parse(
      fs.readFileSync(path.join(this.brainDir, 'synganglion.json'), 'utf8'),
    ) as Synganglion;

    const masters: SpiderBrainMaster[] = Object.entries(graph.nodes)
      .filter(([, node]) => (node.webscore ?? 0) >= 7.0)
      .sort(([, a], [, b]) => (b.webscore ?? 0) - (a.webscore ?? 0))
      .slice(0, 8)
      .map(([id, node]) => ({
        id,
        webscore: node.webscore ?? 0,
        cluster: node.cluster ?? '',
        ...(node.role !== undefined ? { role: node.role } : {}),
        fanIn: node.dependedOnBy?.length ?? 0,
      }));

    const hotFiles: string[] = Object.entries(graph.nodes)
      .filter(([, node]) => node.lastChangedAt !== undefined)
      .sort(
        ([, a], [, b]) =>
          new Date(b.lastChangedAt!).getTime() - new Date(a.lastChangedAt!).getTime(),
      )
      .slice(0, 8)
      .map(([id]) => id);

    const clusterNames: string[] = Object.entries(graph.clusters)
      .sort(([, a], [, b]) => (b.webscore ?? 0) - (a.webscore ?? 0))
      .map(([name]) => name);

    return {
      available: true,
      prey: graph.prey,
      masters,
      hotFiles,
      clusterNames,
    };
  }

  async query(terms: string): Promise<string> {
    // Cap input length to prevent oversized args being passed to the subprocess
    const safeTerms = terms.slice(0, MAX_QUERY_TERMS_CHARS);
    const scriptPath = path.join(SCRIPTS_DIR, 'query.mjs');
    const result = await execa('node', [scriptPath, '--brain', this.brainDir!, safeTerms], {
      reject: false,
    });
    const out = result.stdout ?? '';
    return out.length > MAX_OUTPUT_CHARS
      ? out.slice(0, MAX_OUTPUT_CHARS) + `\n[truncated — ${out.length} total chars]`
      : out;
  }

  async cascade(nodeId: string): Promise<string> {
    if (!SAFE_NODE_ID.test(nodeId) || nodeId.includes('..')) {
      throw new Error(`Invalid node ID: "${nodeId}" contains disallowed characters`);
    }
    const scriptPath = path.join(SCRIPTS_DIR, 'cascade.mjs');
    const result = await execa(
      'node',
      [scriptPath, '--brain', this.brainDir!, '--inject', nodeId],
      { reject: false },
    );
    const out = result.stdout ?? '';
    return out.length > MAX_OUTPUT_CHARS
      ? out.slice(0, MAX_OUTPUT_CHARS) + `\n[truncated — ${out.length} total chars]`
      : out;
  }

  async molt(): Promise<string> {
    const scriptPath = path.join(SCRIPTS_DIR, 'molt.mjs');
    const result = await execa('node', [scriptPath, '--brain', this.brainDir!], {
      reject: false,
    });
    const out = result.stdout ?? '';
    return out.length > MAX_OUTPUT_CHARS
      ? out.slice(0, MAX_OUTPUT_CHARS) + `\n[truncated — ${out.length} total chars]`
      : out;
  }

  buildSystemPromptInjection(context: SpiderBrainContext): string {
    if (!context.available) return '';

    // All values from synganglion.json are treated as untrusted data and XML-escaped
    // to prevent a malicious brain file from injecting instructions into the system prompt.
    const parts: string[] = [`<prey>${escapeXml(context.prey)}</prey>`];

    if (context.masters.length > 0) {
      const list = context.masters
        .map((m) => `  <master id="${escapeXml(m.id)}" webscore="${m.webscore}" cluster="${escapeXml(m.cluster)}" fanIn="${m.fanIn}"${m.role ? ` role="${escapeXml(m.role)}"` : ''} />`)
        .join('\n');
      parts.push(`<masters>\n${list}\n</masters>`);
    }

    if (context.hotFiles.length > 0) {
      const list = context.hotFiles.map((f) => `  <file>${escapeXml(f)}</file>`).join('\n');
      parts.push(`<hot_files>\n${list}\n</hot_files>`);
    }

    if (context.clusterNames.length > 0) {
      parts.push(`<clusters>${context.clusterNames.map(escapeXml).join(', ')}</clusters>`);
    }

    return `<spiderbrain_context>\n${parts.join('\n')}\n</spiderbrain_context>`;
  }
}
