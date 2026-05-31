import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolRegistry } from '../agent/tools/registry.js';
import type { Tool } from '../types/index.js';

type ZodShape = Record<string, z.ZodTypeAny>;

function toMcpInputSchema(tool: Tool): ZodShape {
  const schema = tool.inputSchema;
  const properties = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  const required: string[] =
    (schema as { required?: string[] }).required ?? [];

  const shape: ZodShape = {};
  for (const [key, def] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (def.type) {
      case 'string':
        field = z.string();
        break;
      case 'number':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      default:
        field = z.unknown();
    }
    shape[key] = required.includes(key) ? field : field.optional();
  }
  return shape;
}

export function createMcpServer(registry: ToolRegistry, _projectPath: string): McpServer {
  const server = new McpServer(
    { name: 'koa', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const tool of registry.getAll()) {
    const inputSchema = toMcpInputSchema(tool);
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema },
      async (args) => {
        try {
          const result = await tool.execute(args as Record<string, unknown>);
          return { content: [{ type: 'text', text: String(result) }] };
        } catch (err) {
          return {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

export async function startMcpServer(server: McpServer): Promise<void> {
  process.stderr.write('[koa-mcp] server ready on stdio\n');
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    process.stdin.on('close', resolve);
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
  });
}
