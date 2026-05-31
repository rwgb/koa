import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { compactMessages } from '../agent/loop.js';

// Helpers to build the message shapes Koa actually produces
const userText = (text: string): Anthropic.MessageParam => ({ role: 'user', content: text });
const assistantText = (text: string): Anthropic.MessageParam => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
});
const assistantToolUse = (id: string): Anthropic.MessageParam => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name: 'bash', input: { command: 'ls' } }],
});
const userToolResult = (id: string): Anthropic.MessageParam => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: 'output' }],
});

describe('compactMessages()', () => {
  it('returns the array unchanged when it is within window', () => {
    const msgs = [userText('hi'), assistantText('hello')];
    expect(compactMessages(msgs, 10)).toBe(msgs);
  });

  it('trims to window when all messages are clean user/assistant pairs', () => {
    const msgs = [
      userText('1'), assistantText('a'),
      userText('2'), assistantText('b'),
      userText('3'), assistantText('c'),
    ];
    const result = compactMessages(msgs, 4);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(userText('2'));
  });

  // ── BUG REGRESSION: orphaned tool_result (400 "unexpected tool_use_id") ──

  it('skips a leading tool_result user message and starts at the next plain user message', () => {
    // Scenario: slice lands on a tool_result user message (the tool_use assistant
    // message was cut off). The old partial fix would drop the tool_result but
    // then stop at the next assistant message, leaving messages starting with
    // assistant role — also a 400.
    const msgs = [
      userText('q1'), assistantToolUse('id-A'), userToolResult('id-A'), assistantText('ans1'),
      userText('q2'), assistantToolUse('id-B'), userToolResult('id-B'), assistantText('ans2'),
    ];
    // window=6 → slice(-6) starts at index 2 (userToolResult id-A)
    const result = compactMessages(msgs, 6);
    expect(result[0]!.role).toBe('user');
    expect(typeof result[0]!.content).toBe('string');
    expect(result[0]!.content).toBe('q2');
  });

  it('skips a leading assistant message (tool_use) and starts at the next plain user', () => {
    // Scenario: slice lands on an assistant tool_use message.
    // Old fix would not drop it (only checked for tool_result user msgs), leaving
    // messages starting with assistant role → 400.
    const msgs = [
      userText('q1'), assistantToolUse('id-A'), userToolResult('id-A'), assistantText('ans1'),
      userText('q2'), assistantText('ans2'),
    ];
    // window=4 → slice(-4) starts at index 2 (userToolResult id-A)
    const result = compactMessages(msgs, 4);
    // Must start with a plain user message
    expect(result[0]!.role).toBe('user');
    expect(typeof result[0]!.content).toBe('string');
  });

  it('handles multi-tool-call turn: skips the orphaned tool_result AND the following assistant', () => {
    // Turn with two sequential tool calls (two assistant→user cycles in one turn)
    const msgs = [
      userText('q1'),
      assistantToolUse('id-A'),
      userToolResult('id-A'),
      assistantToolUse('id-B'),
      userToolResult('id-B'),
      assistantText('final'),
      userText('q2'),
      assistantText('ans2'),
    ];
    // window=6 → starts at index 2 (userToolResult id-A)
    const result = compactMessages(msgs, 6);
    expect(result[0]!.role).toBe('user');
    expect(typeof result[0]!.content).toBe('string');
    // tool_result in result must have its matching tool_use in the preceding message
    for (let i = 1; i < result.length; i++) {
      const msg = result[i]!;
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const prev = result[i - 1]!;
        const toolUseIds = new Set(
          Array.isArray(prev.content)
            ? prev.content
                .filter((b: { type: string }) => b.type === 'tool_use')
                .map((b: unknown) => (b as { id: string }).id)
            : [],
        );
        for (const block of msg.content as { type: string; tool_use_id?: string }[]) {
          if (block.type === 'tool_result') {
            expect(toolUseIds.has(block.tool_use_id!)).toBe(true);
          }
        }
      }
    }
  });

  it('returns empty array when every message is a tool_result or assistant (no safe start)', () => {
    // Degenerate case: nothing safe to start from — result is empty but not corrupt
    const msgs = [
      assistantToolUse('id-X'),
      userToolResult('id-X'),
      assistantText('ans'),
    ];
    const result = compactMessages(msgs, 2);
    // No plain user message exists → compact returns [] (next turn adds a fresh user message)
    expect(result).toHaveLength(0);
  });

  it('never leaves a tool_result block without a matching tool_use in the preceding message', () => {
    // Exhaustively test all slice positions on a realistic 10-message history
    const msgs: Anthropic.MessageParam[] = [
      userText('q1'),
      assistantToolUse('T1'),
      userToolResult('T1'),
      assistantText('a1'),
      userText('q2'),
      assistantToolUse('T2'),
      userToolResult('T2'),
      assistantText('a2'),
      userText('q3'),
      assistantText('a3'),
    ];

    for (let window = 1; window <= msgs.length + 2; window++) {
      const result = compactMessages(msgs, window);
      if (result.length === 0) continue;

      // Must start with user role
      expect(result[0]!.role).toBe('user');

      // Every tool_result must have matching tool_use in previous message
      for (let i = 1; i < result.length; i++) {
        const msg = result[i]!;
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
        const prev = result[i - 1]!;
        const useIds = new Set(
          Array.isArray(prev.content)
            ? prev.content
                .filter((b: { type: string }) => b.type === 'tool_use')
                .map((b: unknown) => (b as { id: string }).id)
            : [],
        );
        for (const block of msg.content as { type: string; tool_use_id?: string }[]) {
          if (block.type === 'tool_result') {
            expect(useIds.has(block.tool_use_id!)).toBe(true);
          }
        }
      }
    }
  });
});
