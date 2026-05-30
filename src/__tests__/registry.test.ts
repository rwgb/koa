import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../agent/tools/registry.js';
import type { Tool } from '../types/index.js';

const mockTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
  execute: async (input) => `got: ${String(input['value'])}`,
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool by name', () => {
    registry.register(mockTool);
    expect(registry.get('test_tool')).toBe(mockTool);
  });

  it('returns undefined for unknown tool', () => {
    expect(registry.get('nope')).toBeUndefined();
  });

  it('getAll returns all registered tools', () => {
    registry.register(mockTool);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toBe(mockTool);
  });

  it('toAnthropicTools produces correct shape', () => {
    registry.register(mockTool);
    const tools = registry.toAnthropicTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      input_schema: mockTool.inputSchema,
    });
  });

  it('later registration overwrites earlier for same name', () => {
    const updated: Tool = { ...mockTool, description: 'updated' };
    registry.register(mockTool);
    registry.register(updated);
    expect(registry.get('test_tool')?.description).toBe('updated');
    expect(registry.getAll()).toHaveLength(1);
  });
});
