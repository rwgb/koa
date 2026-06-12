import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  compactMessages,
  groupIntoClusters,
  MIN_PROMPT_BUDGET_TOKENS,
  MIN_PROMPT_BUDGET_RATIO,
  MODEL_CONTEXT_WINDOWS,
} from '../agent/loop.js';

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

describe('groupIntoClusters()', () => {
  it('single user message with no following turns → one cluster', () => {
    const msgs = [userText('hello')];
    const clusters = groupIntoClusters(msgs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual([userText('hello')]);
  });

  it('two user messages with assistant responses → two clusters', () => {
    const msgs = [
      userText('q1'), assistantText('a1'),
      userText('q2'), assistantText('a2'),
    ];
    const clusters = groupIntoClusters(msgs);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toEqual([userText('q1'), assistantText('a1')]);
    expect(clusters[1]).toEqual([userText('q2'), assistantText('a2')]);
  });

  it('cluster includes tool calls and results within the same request-response loop', () => {
    const msgs = [
      userText('run ls'),
      assistantToolUse('T1'),
      userToolResult('T1'),
      assistantText('done'),
      userText('now do something else'),
      assistantText('ok'),
    ];
    const clusters = groupIntoClusters(msgs);
    expect(clusters).toHaveLength(2);
    // First cluster: all 4 messages from the tool-call loop
    expect(clusters[0]).toHaveLength(4);
    expect(clusters[0]![0]).toEqual(userText('run ls'));
    expect(clusters[0]![3]).toEqual(assistantText('done'));
    // Second cluster: the final exchange
    expect(clusters[1]).toHaveLength(2);
  });

  it('last 4 clusters are preserved verbatim when slicing', () => {
    // Build 5 clusters of 2 messages each (10 messages total)
    const msgs: Anthropic.MessageParam[] = [];
    for (let i = 1; i <= 5; i++) {
      msgs.push(userText(`q${i}`), assistantText(`a${i}`));
    }
    const clusters = groupIntoClusters(msgs);
    expect(clusters).toHaveLength(5);

    const KEEP = 4;
    const preserved = clusters.slice(-KEEP);
    expect(preserved).toHaveLength(4);
    // The oldest preserved cluster should be the 2nd cluster (q2/a2)
    expect(preserved[0]![0]).toEqual(userText('q2'));
    // The newest preserved cluster should be the 5th cluster (q5/a5)
    expect(preserved[3]![0]).toEqual(userText('q5'));
  });

  it('empty message array → empty clusters array', () => {
    expect(groupIntoClusters([])).toEqual([]);
  });

  it('messages starting with tool results (no leading user text) grouped into first cluster', () => {
    // Edge case: history starts with a tool result user message (compacted history)
    const msgs = [
      userToolResult('T0'),
      assistantText('summary reply'),
      userText('follow up'),
      assistantText('done'),
    ];
    const clusters = groupIntoClusters(msgs);
    // The first cluster has no user text opener, so it accumulates until the next user text
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toHaveLength(2);
    expect(clusters[1]![0]).toEqual(userText('follow up'));
  });
});

describe('OC-1 token-budget compaction constants', () => {
  it('MIN_PROMPT_BUDGET_TOKENS is 8000', () => {
    expect(MIN_PROMPT_BUDGET_TOKENS).toBe(8_000);
  });

  it('MIN_PROMPT_BUDGET_RATIO is 0.5', () => {
    expect(MIN_PROMPT_BUDGET_RATIO).toBe(0.5);
  });

  it('compressThreshold for a 200k model is 100_000', () => {
    // contextWindow=200000, threshold = 200000 - max(8000, 200000*0.5) = 200000 - 100000 = 100000
    const contextWindow = MODEL_CONTEXT_WINDOWS['claude-sonnet-4-6']!;
    expect(contextWindow).toBe(200_000);
    const threshold = contextWindow - Math.max(MIN_PROMPT_BUDGET_TOKENS, contextWindow * MIN_PROMPT_BUDGET_RATIO);
    expect(threshold).toBe(100_000);
  });

  it('unknown model falls back to 200k context window giving threshold 100_000', () => {
    const contextWindow = MODEL_CONTEXT_WINDOWS['unknown-model-xyz'] ?? 200_000;
    expect(contextWindow).toBe(200_000);
    const threshold = contextWindow - Math.max(MIN_PROMPT_BUDGET_TOKENS, contextWindow * MIN_PROMPT_BUDGET_RATIO);
    expect(threshold).toBe(100_000);
  });

  it('hypothetical 32k model yields threshold 16_000', () => {
    // contextWindow=32000, threshold = 32000 - max(8000, 32000*0.5) = 32000 - max(8000,16000) = 32000 - 16000 = 16000
    const contextWindow = 32_000;
    const threshold = contextWindow - Math.max(MIN_PROMPT_BUDGET_TOKENS, contextWindow * MIN_PROMPT_BUDGET_RATIO);
    expect(threshold).toBe(16_000);
  });
});
