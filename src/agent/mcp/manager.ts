import { McpClient, type McpServerConfig } from './client.js';
import type { Tool } from '../../types/index.js';

export class McpManager {
  private clients: McpClient[] = [];

  constructor(configs: McpServerConfig[]) {
    this.clients = configs.map((c) => new McpClient(c));
  }

  async connectAll(): Promise<void> {
    await Promise.allSettled(
      this.clients.map(async (c) => {
        try {
          await c.connect();
        } catch (err) {
          console.error(`[mcp] failed to connect to "${c.name}": ${String(err)}`);
        }
      }),
    );
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.disconnect()));
  }

  async getTools(): Promise<Tool[]> {
    const results = await Promise.allSettled(
      this.clients.filter((c) => c.connected).map((c) => c.getTools()),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<Tool[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  }

  serverStatus(): Array<{ name: string; connected: boolean }> {
    return this.clients.map((c) => ({ name: c.name, connected: c.connected }));
  }
}
