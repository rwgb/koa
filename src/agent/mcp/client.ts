import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '../../types/index.js';
import { wrapUntrusted } from '../tools/untrusted.js';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  trusted?: boolean | undefined;
}

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport;
  private _connected = false;

  constructor(private config: McpServerConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    });
    this.client = new Client({ name: 'koa', version: '1.0.0' }, { capabilities: {} });
  }

  get connected(): boolean {
    return this._connected;
  }

  get name(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    await this.client.close();
    this._connected = false;
  }

  async getTools(): Promise<Tool[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => {
      const toolName = `mcp_${this.config.name}_${t.name}`;
      const trusted = this.config.trusted === true;
      return {
        name: toolName,
        description: `[${this.config.name}] ${t.description ?? ''}`,
        inputSchema: (t.inputSchema ?? { type: 'object' as const, properties: {} }) as Anthropic.Tool['input_schema'],
        source: 'plugin' as const,
        execute: async (input: Record<string, unknown>): Promise<string> => {
          const result = await this.client.callTool({
            name: t.name,
            arguments: input,
          });
          const text = (result.content as Array<{ type: string; text?: string }>)
            .map((c) => (c.type === 'text' && c.text ? c.text : JSON.stringify(c)))
            .join('\n');
          return trusted ? text : wrapUntrusted(text);
        },
      } as Tool;
    });
  }
}
