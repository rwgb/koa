import { MODELS } from './router.js';
import { MODEL_MAP } from '../types/index.js';

export type AgentName = 'code-assistant' | 'project-manager' | 'life-manager';

export interface AgentSpec {
  name: AgentName;
  label: string;
  model: string;
}

const CODE_SYSTEM = `You are Koa in Code Assistant mode. You specialise in software engineering: writing, debugging, and refactoring code; explaining technical concepts; running shell commands; reading and editing files. Favour precision and completeness over brevity.`;

const PM_SYSTEM = `You are Koa in Project Manager mode. You specialise in task and project management: listing tasks, setting priorities, tracking status, updating deadlines, and answering "what's next?" queries. Keep responses concise and action-oriented. Use the available project database tools to read and update tasks.`;

function buildLmSystem(userName: string): string {
  return `You are Koa in Life Manager mode. You specialise in personal productivity, habits, goals, and life planning across all projects. You have access to calendar data showing ${userName}'s actual schedule — use it to give realistic time estimates, flag deadline conflicts, and identify open blocks for focused work. Provide high-level summaries, spot patterns, and help ${userName} prioritise what matters. Keep responses warm, concise, and forward-looking.`;
}

export function buildAgentSpecs(userName: string): Record<AgentName, AgentSpec & { systemAddition: string }> {
  return {
    'code-assistant': {
      name: 'code-assistant',
      label: 'Code',
      model: MODELS.sonnet,
      systemAddition: CODE_SYSTEM,
    },
    'project-manager': {
      name: 'project-manager',
      label: 'PM',
      model: MODEL_MAP.fast,
      systemAddition: PM_SYSTEM,
    },
    'life-manager': {
      name: 'life-manager',
      label: 'Life',
      model: MODEL_MAP.fast,
      systemAddition: buildLmSystem(userName),
    },
  };
}

// Backward-compat export for code that imports AGENT_SPECS directly
export const AGENT_SPECS = buildAgentSpecs('User');
