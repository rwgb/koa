// Model tier identifiers
export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
} as const;

export type ModelTier = keyof typeof MODELS;

// Returns the tier override if the message starts with @haiku:/@sonnet:/@opus:
// Also strips the prefix from the message text
export function extractTierOverride(message: string): { tier: ModelTier | null; message: string } {
  const match = /^@(haiku|sonnet|opus):\s*/i.exec(message);
  if (!match) return { tier: null, message };
  return {
    tier: match[1]!.toLowerCase() as ModelTier,
    message: message.slice(match[0].length),
  };
}

export type MessageComplexity = 'simple' | 'moderate' | 'complex';

const SIMPLE_RE =
  /^(what|who|where|when|show|list|get|find|check|is|does|can|how many|tell me)\b/i;
const COMPLEX_RE =
  /\b(refactor|architect|design|implement|optimize|rewrite|migrate|build|create a|add a|fix|debug)\b/i;

export function classifyMessage(message: string, recentToolUseCount = 0): MessageComplexity {
  if (recentToolUseCount >= 3) return 'complex';
  const len = message.length;
  if (COMPLEX_RE.test(message) || len > 400) return 'complex';
  if (len > 120 || !SIMPLE_RE.test(message)) return 'moderate';
  return 'simple';
}

export function selectModel(
  message: string,
  recentToolUseCount: number,
  config: { model: string; smartRouting: boolean },
): { model: string; tier: ModelTier; cleanMessage: string } {
  const { tier: override, message: cleanMessage } = extractTierOverride(message);

  if (override) {
    return { model: MODELS[override], tier: override, cleanMessage };
  }

  if (!config.smartRouting) {
    // Determine tier label for display only
    const tier: ModelTier =
      config.model === MODELS.haiku ? 'haiku' : config.model === MODELS.opus ? 'opus' : 'sonnet';
    return { model: config.model, tier, cleanMessage: message };
  }

  const complexity = classifyMessage(message, recentToolUseCount);
  const tier: ModelTier =
    complexity === 'simple' ? 'haiku' : complexity === 'complex' ? 'opus' : 'sonnet';
  return { model: MODELS[tier], tier, cleanMessage: message };
}
