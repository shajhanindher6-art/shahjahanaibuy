/**
 * Section 19, §12 #7 (spend-alert half) — spendAlertBudgets.
 *
 * Pure threshold check over a usage summary's budgets: alert at
 * ≥80% used, never below, never for an uncapped budget. Plus a
 * live-counter check that the real SerpAPI budget (5/day) alerts
 * exactly when the 4th call is spent.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SPEND_ALERT_THRESHOLD,
  getAiUsageSummary,
  resetAiUsage,
  spendAlertBudgets,
  spendProviderBudget,
  type AiProviderBudgetState,
} from '@/services/ai-engine/usage';

function budget(key: string, used: number, budgetTotal: number): AiProviderBudgetState {
  return {
    key,
    used,
    budget: budgetTotal,
    remaining: Math.max(0, budgetTotal - used),
    exhausted: used >= budgetTotal,
  };
}

describe('spendAlertBudgets', () => {
  it('alerts at exactly the 80% threshold', () => {
    expect(SPEND_ALERT_THRESHOLD).toBe(0.8);
    expect(spendAlertBudgets([budget('serpapi', 4, 5)])).toMatchObject([
      { key: 'serpapi', used: 4, budget: 5, percentUsed: 0.8, exhausted: false },
    ]);
  });

  it('stays silent below 80%', () => {
    expect(spendAlertBudgets([budget('serpapi', 3, 5)])).toEqual([]);
    expect(spendAlertBudgets([budget('huggingface', 39, 50)])).toEqual([]);
  });

  it('alerts on an exhausted budget', () => {
    expect(spendAlertBudgets([budget('serpapi', 5, 5)])).toMatchObject([
      { key: 'serpapi', used: 5, budget: 5, percentUsed: 1, exhausted: true },
    ]);
  });

  it('never alerts for an uncapped (zero) budget', () => {
    expect(spendAlertBudgets([budget('unknown-provider', 100, 0)])).toEqual([]);
  });

  it('returns only the budgets at/above threshold', () => {
    const alerts = spendAlertBudgets([
      budget('serpapi', 4, 5),
      budget('huggingface', 10, 50),
    ]);
    expect(alerts.map((a) => a.key)).toEqual(['serpapi']);
  });
});

describe('live counters → alert', () => {
  beforeEach(() => resetAiUsage());

  it('the real SerpAPI budget alerts after the 4th spent call', () => {
    for (let i = 0; i < 3; i++) spendProviderBudget('serpapi');
    expect(spendAlertBudgets(getAiUsageSummary().budgets)).toEqual([]);
    spendProviderBudget('serpapi');
    expect(spendAlertBudgets(getAiUsageSummary().budgets)).toMatchObject([
      { key: 'serpapi', used: 4, budget: 5, exhausted: false },
    ]);
  });
});
