/**
 * Unit tests for lib/agent-memory.ts (S5#1 — personal AI shopping
 * agent): rule validation, price matching, memory merging, the
 * deterministic deal summary, and the fail-safe guest storage
 * (which must no-op in Node, where localStorage does not exist).
 */

import { describe, expect, it } from 'vitest';
import {
  applyPreferencesUpdate,
  clearGuestMemory,
  describeRule,
  emptyMemory,
  loadGuestMemory,
  loadGuestRules,
  mergeSeenProducts,
  newGuestRule,
  ruleMatchesPrice,
  ruleToAlertInput,
  saveGuestMemory,
  saveGuestRules,
  summarizeDealsForMemory,
  validatePreferences,
  validateRuleInput,
  type AgentRule,
} from '@/lib/agent-memory';

function makeRule(overrides: Partial<AgentRule> = {}): AgentRule {
  return {
    id: 'rule-1',
    userId: 'user-1',
    productId: 'prod-1',
    productSlug: 'macbook-air-13',
    productName: 'MacBook Air 13',
    targetPriceUsd: 800,
    channel: 'email',
    alertId: 'alert-1',
    active: true,
    lastTriggeredAt: null,
    triggerCount: 0,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateRuleInput', () => {
  it('accepts a valid rule', () => {
    expect(
      validateRuleInput({ productSlug: 'macbook-air-13', targetPriceUsd: 800 })
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects a rule with no product', () => {
    const result = validateRuleInput({ targetPriceUsd: 800 });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/product/i);
  });

  it('rejects zero, negative, and non-number targets', () => {
    for (const target of [0, -50, NaN, Infinity, '800', undefined]) {
      expect(validateRuleInput({ productSlug: 'x', targetPriceUsd: target }).ok).toBe(false);
    }
  });

  it('rejects an unknown channel', () => {
    const result = validateRuleInput({
      productSlug: 'x',
      targetPriceUsd: 100,
      channel: 'sms' as 'email',
    });
    expect(result.ok).toBe(false);
  });
});

describe('validatePreferences', () => {
  it('accepts empty and valid preferences', () => {
    expect(validatePreferences({}).ok).toBe(true);
    expect(validatePreferences({ maxBudgetUsd: 800, categories: ['Laptops'] }).ok).toBe(true);
  });

  it('rejects a non-positive budget', () => {
    expect(validatePreferences({ maxBudgetUsd: 0 }).ok).toBe(false);
    expect(validatePreferences({ maxBudgetUsd: -10 }).ok).toBe(false);
  });
});

describe('ruleMatchesPrice', () => {
  it('matches when the recorded price is at or under target', () => {
    expect(ruleMatchesPrice(makeRule(), 800)).toBe(true);
    expect(ruleMatchesPrice(makeRule(), 799.99)).toBe(true);
  });

  it('does not match above target', () => {
    expect(ruleMatchesPrice(makeRule(), 800.01)).toBe(false);
  });

  it('never matches a missing price', () => {
    expect(ruleMatchesPrice(makeRule(), null)).toBe(false);
    expect(ruleMatchesPrice(makeRule(), NaN)).toBe(false);
  });
});

describe('ruleToAlertInput', () => {
  it('maps a rule onto a price_drop alert with the rule target', () => {
    expect(ruleToAlertInput(makeRule())).toEqual({
      productId: 'prod-1',
      alertType: 'price_drop',
      conditionValue: 800,
      channel: 'email',
    });
  });

  it('returns null when the rule has no resolved product id', () => {
    expect(ruleToAlertInput(makeRule({ productId: null }))).toBeNull();
  });

  it('maps a device-only channel to email (never "local" in the alert chain)', () => {
    expect(ruleToAlertInput(makeRule({ channel: 'local' }))?.channel).toBe('email');
  });
});

describe('describeRule', () => {
  it('reports paused, unknown, met, and above-target states honestly', () => {
    expect(describeRule(makeRule({ active: false }), 700)).toMatch(/Paused/i);
    expect(describeRule(makeRule(), null)).toMatch(/not recorded/i);
    expect(describeRule(makeRule(), 750)).toMatch(/under your \$800 target/i);
    expect(describeRule(makeRule(), 999)).toMatch(/above your \$800 target/i);
  });
});

describe('mergeSeenProducts', () => {
  it('dedupes and puts the newest slug first', () => {
    expect(mergeSeenProducts(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(mergeSeenProducts(['a'], 'c')).toEqual(['c', 'a']);
  });

  it('caps the list and ignores blank slugs', () => {
    expect(mergeSeenProducts(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(mergeSeenProducts(['a'], '   ')).toEqual(['a']);
  });
});

describe('applyPreferencesUpdate', () => {
  it('merges a patch and lets null clear a field', () => {
    const next = applyPreferencesUpdate(
      { maxBudgetUsd: 1000, categories: ['Phones'] },
      { maxBudgetUsd: null, lightweightOnly: true }
    );
    expect(next.maxBudgetUsd).toBeNull();
    expect(next.categories).toEqual(['Phones']);
    expect(next.lightweightOnly).toBe(true);
  });

  it('drops blank categories and brands', () => {
    const next = applyPreferencesUpdate(
      {},
      { categories: ['Laptops', '  '], preferredBrands: [' Apple ', ''] }
    );
    expect(next.categories).toEqual(['Laptops']);
    expect(next.preferredBrands).toEqual(['Apple']);
  });
});

describe('emptyMemory', () => {
  it('starts with no preferences, no seen products, no consent', () => {
    const memory = emptyMemory('user-1');
    expect(memory.preferences).toEqual({});
    expect(memory.seenProductSlugs).toEqual([]);
    expect(memory.consentGrantedAt).toBeNull();
  });
});

describe('summarizeDealsForMemory', () => {
  it('reports an honest empty state with nothing watched', () => {
    const summary = summarizeDealsForMemory([]);
    expect(summary.watchedCount).toBe(0);
    expect(summary.text).toMatch(/not watching any products/i);
  });

  it('counts met targets from real recorded prices only', () => {
    const summary = summarizeDealsForMemory([
      { slug: 'a', name: 'A', currentPriceUsd: 750, targetPriceUsd: 800 },
      { slug: 'b', name: 'B', currentPriceUsd: 999, targetPriceUsd: 800 },
      { slug: 'c', name: 'C', currentPriceUsd: null, targetPriceUsd: 500 },
    ]);
    expect(summary.metCount).toBe(1);
    expect(summary.unknownCount).toBe(1);
    expect(summary.items[0].targetMet).toBe(true);
    expect(summary.items[1].targetMet).toBe(false);
    expect(summary.items[2].priceUnknown).toBe(true);
    expect(summary.text).toMatch(/1 of 3/);
    expect(summary.text).toMatch(/recorded/i);
  });

  it('says plainly when every watched product has no recorded price', () => {
    const summary = summarizeDealsForMemory([
      { slug: 'a', name: 'A', currentPriceUsd: null, targetPriceUsd: 800 },
    ]);
    expect(summary.text).toMatch(/no recorded price/i);
  });

  it('adds the budget line only when a budget is set', () => {
    const watched = [{ slug: 'a', name: 'A', currentPriceUsd: 750, targetPriceUsd: null }];
    expect(summarizeDealsForMemory(watched, { maxBudgetUsd: 800 }).text).toMatch(
      /1 of 1 is within your \$800 budget/i
    );
    expect(summarizeDealsForMemory(watched, {}).text).not.toMatch(/budget/i);
  });
});

describe('guest storage (Node — no localStorage)', () => {
  it('fails safe: loads return empty, saves return false, never throws', () => {
    expect(loadGuestMemory()).toBeNull();
    expect(loadGuestRules()).toEqual([]);
    expect(saveGuestMemory({ preferences: {}, seenProductSlugs: [], consentGrantedAt: null })).toBe(false);
    expect(saveGuestRules([])).toBe(false);
    expect(() => clearGuestMemory()).not.toThrow();
  });
});

describe('newGuestRule', () => {
  it('builds a device-only rule with no alert link', () => {
    const rule = newGuestRule({ productSlug: 'macbook-air-13', targetPriceUsd: 800 });
    expect(rule).not.toBeNull();
    expect(rule?.channel).toBe('local');
    expect(rule?.alertId).toBeNull();
    expect(rule?.userId).toBeNull();
    expect(rule?.active).toBe(true);
  });

  it('returns null for an invalid rule', () => {
    expect(newGuestRule({ productSlug: 'x', targetPriceUsd: 0 })).toBeNull();
    expect(newGuestRule({ targetPriceUsd: 100 })).toBeNull();
  });
});
