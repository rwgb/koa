import type Anthropic from '@anthropic-ai/sdk';
import { HAIKU_CLASSIFIER_TIMEOUT_MS } from '../config/index.js';

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

export type RoutingSource = 'override' | 'regex-fast-path' | 'haiku-classifier' | 'config';

const SIMPLE_RE =
  /^(what|who|where|when|show|list|get|find|check|is|does|can|how many|tell me)\b/i;
const COMPLEX_RE =
  /\b(refactor|architect|design|implement|optimize|rewrite|migrate|build|create a|add a|fix|debug)\b/i;

const CLASSIFIER_SYSTEM = `You are a request complexity classifier. Given a user message, reply with exactly one digit:
1 = simple: factual lookup, short answer, no code changes, no reasoning chain needed
2 = moderate: some analysis, explanation, or minor code change
3 = complex: architecture decisions, multi-step reasoning, debugging, refactoring, or large code changes

Reply with only the digit. No other text.`;

export function classifyMessage(message: string, recentToolUseCount = 0): MessageComplexity {
  if (recentToolUseCount >= 3) return 'complex';
  const len = message.length;
  if (COMPLEX_RE.test(message) || len > 400) return 'complex';
  if (len > 120 || !SIMPLE_RE.test(message)) return 'moderate';
  return 'simple';
}

export async function classifyWithHaiku(
  message: string,
  anthropicClient: Anthropic,
): Promise<{ complexity: MessageComplexity; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HAIKU_CLASSIFIER_TIMEOUT_MS);
  try {
    const response = await anthropicClient.messages.create(
      {
        model: MODELS.haiku,
        max_tokens: 16,
        temperature: 0,
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: message }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timer);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const first = text[0];
    const complexity: MessageComplexity =
      first === '1' ? 'simple' : first === '3' ? 'complex' : 'moderate';

    return {
      complexity,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch {
    clearTimeout(timer);
    return { complexity: 'moderate', inputTokens: 0, outputTokens: 0 };
  }
}

export async function selectModel(
  message: string,
  recentToolUseCount: number,
  config: { model: string; smartRouting: boolean },
  anthropicClient: Anthropic,
): Promise<{
  model: string;
  tier: ModelTier;
  cleanMessage: string;
  source: RoutingSource;
  classifierLatencyMs?: number;
  classifierUsage?: { inputTokens: number; outputTokens: number };
}> {
  const { tier: override, message: cleanMessage } = extractTierOverride(message);

  if (override) {
    debugLog(`tier=${override} source=override`);
    return { model: MODELS[override], tier: override, cleanMessage, source: 'override' };
  }

  if (!config.smartRouting) {
    const tier: ModelTier =
      config.model === MODELS.haiku ? 'haiku' : config.model === MODELS.opus ? 'opus' : 'sonnet';
    debugLog(`tier=${tier} source=config`);
    return { model: config.model, tier, cleanMessage: message, source: 'config' };
  }

  const complexity = classifyMessage(message, recentToolUseCount);

  if (complexity === 'simple') {
    debugLog(`tier=haiku source=regex-fast-path`);
    return { model: MODELS.haiku, tier: 'haiku', cleanMessage: message, source: 'regex-fast-path' };
  }

  if (complexity === 'complex') {
    debugLog(`tier=opus source=regex-fast-path`);
    return { model: MODELS.opus, tier: 'opus', cleanMessage: message, source: 'regex-fast-path' };
  }

  // Moderate: refine with Haiku classifier
  const t0 = Date.now();
  const { complexity: refined, inputTokens, outputTokens } = await classifyWithHaiku(message, anthropicClient);
  const classifierLatencyMs = Date.now() - t0;

  const tier: ModelTier =
    refined === 'simple' ? 'haiku' : refined === 'complex' ? 'opus' : 'sonnet';

  debugLog(`tier=${tier} source=haiku-classifier latency=${classifierLatencyMs}ms`);
  return {
    model: MODELS[tier],
    tier,
    cleanMessage: message,
    source: 'haiku-classifier',
    classifierLatencyMs,
    classifierUsage: { inputTokens, outputTokens },
  };
}

function debugLog(msg: string): void {
  if (process.env['KOA_DEBUG']) {
    process.stderr.write(`[router] ${msg}\n`);
  }
}
