import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from '../../types/index.js';
import { writeHandoff } from '../../project-memory/store.js';
import { HAIKU_MODEL } from '../../config/index.js';

const TEMPLATES_DIR = path.join(os.homedir(), 'claudeAgents', 'tools', 'agent-templates');
const ALLOWED_AGENTS = ['architect', 'reviewer', 'debug', 'security-reviewer'] as const;
type AllowedAgent = (typeof ALLOWED_AGENTS)[number];
const MAX_OUTPUT_CHARS = 8000;

function isAllowedAgent(name: string): name is AllowedAgent {
  return (ALLOWED_AGENTS as readonly string[]).includes(name);
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  return end === -1 ? markdown : markdown.slice(end + 4).trimStart();
}

export function createAgentDispatchTool(projectPath: string, apiKey?: string): Tool {
  return {
    name: 'dispatch_agent',
    description:
      'Spawn a specialist sub-agent to handle planning, review, or debugging. ' +
      `Allowed agents: ${ALLOWED_AGENTS.join(', ')}. ` +
      'The agent reads its task and returns structured markdown output (TASKS.md, review report, debug findings, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: `Which specialist agent to dispatch. One of: ${ALLOWED_AGENTS.join(', ')}.`,
        },
        task: {
          type: 'string',
          description: 'The task description to give the agent. Be specific.',
        },
        context: {
          type: 'string',
          description: 'Optional additional context to include with the task.',
        },
      },
      required: ['agent', 'task'],
    },
    execute: async (input: Record<string, unknown>) => {
      const agentName = String(input['agent'] ?? '').trim();
      const task = String(input['task'] ?? '').trim();
      const context = input['context'] ? String(input['context']).trim() : '';

      if (!isAllowedAgent(agentName)) {
        return `Error: "${agentName}" is not an allowed agent. Choose from: ${ALLOWED_AGENTS.join(', ')}`;
      }
      if (!task) return 'Error: task is required';
      if (!apiKey) return 'Error: API key not configured';

      const templatePath = path.join(TEMPLATES_DIR, `${agentName}.md`);
      let templateContent: string;
      try {
        templateContent = fs.readFileSync(templatePath, 'utf8');
      } catch {
        return `Error: agent template not found at ${templatePath}`;
      }

      const systemPrompt = stripFrontmatter(templateContent);
      const userMessage = context ? `${task}\n\nAdditional context:\n${context}` : task;

      writeHandoff(projectPath, {
        agent: agentName,
        lastAgent: 'koa',
        nextAgent: agentName,
        status: 'RUNNING',
        plan: `Dispatching ${agentName} agent for: ${task.slice(0, 120)}`,
      });

      try {
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model: HAIKU_MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        writeHandoff(projectPath, {
          agent: agentName,
          lastAgent: agentName,
          nextAgent: 'koa',
          status: 'PASS',
          plan: output.slice(0, 500),
        });

        return output.length > MAX_OUTPUT_CHARS
          ? output.slice(0, MAX_OUTPUT_CHARS) + `\n[truncated — ${output.length} total chars]`
          : output;
      } catch (err) {
        writeHandoff(projectPath, {
          agent: agentName,
          lastAgent: agentName,
          nextAgent: 'koa',
          status: 'FAIL',
          plan: `Agent failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
