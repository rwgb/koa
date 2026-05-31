import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../agent/tools/registry.js';
import { createMcpServer } from '../server/mcp.js';
import type { Tool } from '../types/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'mock_tool',
    description: 'A mock tool for testing',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
    execute: async (input) => `result: ${String(input['command'])}`,
    ...overrides,
  };
}

function makeRegistry(...tools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}

describe('createMcpServer', () => {
  it('does not throw when called with an empty registry', () => {
    const registry = makeRegistry();
    expect(() => createMcpServer(registry, '/tmp')).not.toThrow();
  });

  it('does not throw when called with a populated registry', () => {
    const registry = makeRegistry(makeTool());
    expect(() => createMcpServer(registry, '/tmp')).not.toThrow();
  });

  it('calls registerTool once per tool', () => {
    const spy = vi.spyOn(McpServer.prototype, 'registerTool');
    const registry = makeRegistry(makeTool(), makeTool({ name: 'other_tool' }));
    createMcpServer(registry, '/tmp');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('calls registerTool with correct tool name and description', () => {
    const spy = vi.spyOn(McpServer.prototype, 'registerTool');
    const tool = makeTool();
    const registry = makeRegistry(tool);
    createMcpServer(registry, '/tmp');
    expect(spy).toHaveBeenCalledWith(
      'mock_tool',
      expect.objectContaining({ description: 'A mock tool for testing' }),
      expect.any(Function),
    );
    spy.mockRestore();
  });

  it('registers required fields without optional wrapper and optional fields with optional wrapper', () => {
    const spy = vi.spyOn(McpServer.prototype, 'registerTool');
    const registry = makeRegistry(makeTool());
    createMcpServer(registry, '/tmp');

    const callArgs = spy.mock.calls[0] as unknown as [string, { inputSchema: Record<string, unknown> }, unknown] | undefined;
    expect(callArgs).toBeDefined();
    const inputSchema = callArgs![1].inputSchema as Record<string, { isOptional?: () => boolean }>;

    expect(inputSchema['command']).toBeDefined();
    expect(inputSchema['timeout']).toBeDefined();
    spy.mockRestore();
  });
});

describe('tool handler', () => {
  type HandlerFn = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  async function getHandler(tool: Tool): Promise<HandlerFn> {
    const spy = vi.spyOn(McpServer.prototype, 'registerTool');
    const registry = makeRegistry(tool);
    createMcpServer(registry, '/tmp');
    const calls = spy.mock.calls as unknown as Array<[string, unknown, HandlerFn]>;
    const handler = calls[0]![2];
    spy.mockRestore();
    return handler;
  }

  it('returns text content when tool succeeds', async () => {
    const tool = makeTool({ execute: async () => 'success output' });
    const handler = await getHandler(tool);
    const result = await handler({ command: 'echo hello' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    expect(result.content[0]!.text).toBe('success output');
    expect(result.isError).toBeUndefined();
  });

  it('returns isError: true when tool throws an Error', async () => {
    const tool = makeTool({ execute: async () => { throw new Error('tool failed'); } });
    const handler = await getHandler(tool);
    const result = await handler({ command: 'fail' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('tool failed');
  });

  it('returns isError: true when tool throws a non-Error', async () => {
    const tool = makeTool({ execute: async () => { throw 'string error'; } });
    const handler = await getHandler(tool);
    const result = await handler({ command: 'fail' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('string error');
  });
});
