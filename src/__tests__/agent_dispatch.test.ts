import { describe, it, expect } from 'vitest';
import { createAgentDispatchTool } from '../agent/tools/agent_dispatch_tool.js';

// Tests cover validation and error paths that don't require real API calls.
// The actual agent execution (Anthropic SDK call + HANDOFF.md write) is tested
// manually / via integration since it requires a live API key.

describe('createAgentDispatchTool() — tool metadata', () => {
  it('has the correct tool name', () => {
    const tool = createAgentDispatchTool('/tmp/project');
    expect(tool.name).toBe('dispatch_agent');
  });

  it('requires agent and task in inputSchema', () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const schema = tool.inputSchema as unknown as { required: string[] };
    expect(schema.required).toContain('agent');
    expect(schema.required).toContain('task');
  });

  it('does not require context in inputSchema', () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const schema = tool.inputSchema as unknown as { required: string[] };
    expect(schema.required).not.toContain('context');
  });

  it('description lists all allowed agents', () => {
    const tool = createAgentDispatchTool('/tmp/project');
    expect(tool.description).toContain('architect');
    expect(tool.description).toContain('reviewer');
    expect(tool.description).toContain('debug');
    expect(tool.description).toContain('security-reviewer');
  });
});

describe('dispatch_agent execute() — validation errors (no API call)', () => {
  it('rejects an unknown agent name', async () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const result = await tool.execute({ agent: 'hacker', task: 'do something' });
    expect(result).toMatch(/not an allowed agent/i);
    expect(result).toContain('hacker');
  });

  it('rejects an empty agent string', async () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const result = await tool.execute({ agent: '', task: 'do something' });
    expect(result).toMatch(/not an allowed agent/i);
  });

  it('rejects an agent name with injection characters', async () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const result = await tool.execute({ agent: '../evil', task: 'do something' });
    expect(result).toMatch(/not an allowed agent/i);
  });

  it('rejects when task is empty', async () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const result = await tool.execute({ agent: 'architect', task: '' });
    expect(result).toMatch(/task is required/i);
  });

  it('rejects when task is whitespace only', async () => {
    const tool = createAgentDispatchTool('/tmp/project');
    const result = await tool.execute({ agent: 'architect', task: '   ' });
    expect(result).toMatch(/task is required/i);
  });

  it('returns error when apiKey is not provided', async () => {
    const tool = createAgentDispatchTool('/tmp/project', undefined);
    const result = await tool.execute({ agent: 'reviewer', task: 'review the code' });
    expect(result).toMatch(/api key not configured/i);
  });

  it('returns error when apiKey is explicitly undefined', async () => {
    const tool = createAgentDispatchTool('/tmp/project', undefined);
    const result = await tool.execute({ agent: 'debug', task: 'find the bug' });
    expect(result).toMatch(/api key not configured/i);
  });
});

describe('dispatch_agent — allowed agent list', () => {
  // Each allowed agent should reach the apiKey check, not the agent-name-rejection check
  const allowedAgents = ['architect', 'reviewer', 'debug', 'security-reviewer'];

  for (const agent of allowedAgents) {
    it(`"${agent}" passes name validation (reaches apiKey check)`, async () => {
      const tool = createAgentDispatchTool('/tmp/project', undefined);
      const result = await tool.execute({ agent, task: 'do something' });
      // Should fail on missing apiKey, NOT on agent name rejection
      expect(result).not.toMatch(/not an allowed agent/i);
      expect(result).toMatch(/api key not configured/i);
    });
  }
});
