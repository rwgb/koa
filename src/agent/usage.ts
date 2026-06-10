import type { TurnUsage, SessionUsageStats, AgentCostEntry } from '../types/index.js';

interface PricingTier {
  inputPerM: number;
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
}

const PRICING: Record<string, PricingTier> = {
  'claude-haiku': { inputPerM: 0.80, outputPerM: 4.00, cacheWritePerM: 1.00, cacheReadPerM: 0.08 },
  'claude-sonnet': { inputPerM: 3.00, outputPerM: 15.00, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
  'claude-opus': { inputPerM: 15.00, outputPerM: 75.00, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
  'default': { inputPerM: 3.00, outputPerM: 15.00, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
};

// Sort prefixes by length descending to avoid shorter prefixes matching before longer ones
const SORTED_PREFIXES = Object.keys(PRICING)
  .filter(k => k !== 'default')
  .sort((a, b) => b.length - a.length);

export function getPricing(model: string): PricingTier {
  for (const prefix of SORTED_PREFIXES) {
    if (model.startsWith(prefix)) return PRICING[prefix]!;
  }
  return PRICING['default']!;
}

function computeCost(
  pricing: PricingTier,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  return (
    inputTokens * pricing.inputPerM +
    outputTokens * pricing.outputPerM +
    cacheWriteTokens * pricing.cacheWritePerM +
    cacheReadTokens * pricing.cacheReadPerM
  ) / 1_000_000;
}

export class UsageTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheWriteTokens = 0;
  private cacheReadTokens = 0;
  private estimatedCostUsd = 0;
  private cacheHitRate = 0;
  private turnsCount = 0;
  private classifierCalls = 0;
  private classifierInputTokens = 0;
  private classifierOutputTokens = 0;
  private agentBreakdown: Record<string, AgentCostEntry> = {};

  addTurn(usage: TurnUsage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cacheWriteTokens += usage.cacheWriteTokens;
    this.cacheReadTokens += usage.cacheReadTokens;
    this.turnsCount++;

    const pricing = getPricing(usage.model);
    this.estimatedCostUsd = computeCost(
      pricing,
      this.inputTokens,
      this.outputTokens,
      this.cacheWriteTokens,
      this.cacheReadTokens,
    );

    const denominator = this.inputTokens + this.cacheReadTokens + this.cacheWriteTokens;
    this.cacheHitRate = denominator === 0 ? 0 : this.cacheReadTokens / denominator;

    if (usage.agent) {
      const turnCost = computeCost(
        pricing,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheWriteTokens,
        usage.cacheReadTokens,
      );
      const entry = this.agentBreakdown[usage.agent] ?? { turns: 0, estimatedCostUsd: 0 };
      this.agentBreakdown[usage.agent] = {
        turns: entry.turns + 1,
        estimatedCostUsd: entry.estimatedCostUsd + turnCost,
      };
    }
  }

  addClassifierCall(inputTokens: number, outputTokens: number): void {
    this.classifierCalls++;
    this.classifierInputTokens += inputTokens;
    this.classifierOutputTokens += outputTokens;
    // Classifier cost folds into estimatedCostUsd using haiku pricing
    const pricing = getPricing('claude-haiku');
    this.estimatedCostUsd += (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
  }

  getStats(): SessionUsageStats {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      cacheReadTokens: this.cacheReadTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      cacheHitRate: this.cacheHitRate,
      turnsCount: this.turnsCount,
      classifierCalls: this.classifierCalls,
      classifierInputTokens: this.classifierInputTokens,
      classifierOutputTokens: this.classifierOutputTokens,
      agentBreakdown: { ...this.agentBreakdown },
    };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheWriteTokens = 0;
    this.cacheReadTokens = 0;
    this.estimatedCostUsd = 0;
    this.cacheHitRate = 0;
    this.turnsCount = 0;
    this.classifierCalls = 0;
    this.classifierInputTokens = 0;
    this.classifierOutputTokens = 0;
    this.agentBreakdown = {};
  }
}
