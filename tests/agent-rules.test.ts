/**
 * Unit tests for the agent rules layer (S5#1 — autonomous rules):
 * the dedupe key that backs the UNIQUE(user_id, product_slug,
 * target_price_usd) constraint, the rule → existing-alert-chain
 * mapping, and the honest per-rule status text.
 */

import { describe, expect, it } from 'vitest';
import {
  describeRule,
  ruleDedupeKey,
  ruleMatchesPrice,
  ruleToAlertInput,
  validateRuleInput,
  type AgentRule,
} from '@/lib/agent-memory';

function makeRule(overrides: Partial<AgentRule> = {}): AgentRule {
  return {
    id: 'rule-1',
    userId: 'user-1',
    productId: 'prod-1',
    productSlug: 'MacBook-Air-13',
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

describe('ruleDedupeKey', () => {
  it('is stable for the same user + product + target', () => {
    expect(ruleDedupeKey('u1', 'macbook-air-13', 800)).toBe(
      ruleDedupeKey('u1', 'macbook-air-13', 800)
    );
  });

  it('treats the slug case-insensitively', () => {
    expect(ruleDedupeKey('u1', 'MacBook-Air-13', 800)).toBe(
      ruleDedupeKey('u1', 'macbook-air-13', 800)
    );
  });

  it('differs across users, products, and target prices', () => {
    const base = ruleDedupeKey('u1', 'macbook-air-13', 800);
    expect(ruleDedupeKey('u2', 'macbook-air-13', 800)).not.toBe(base);
    expect(ruleDedupeKey('u1', 'dell-xps-13', 800)).not.toBe(base);
    expect(ruleDedupeKey('u1', 'macbook-air-13', 700)).not.toBe(base);
  });
});

describe('rule → alert chain mapping', () => {
  it('creates a price_drop alert input with the rule target as the condition', () => {
    const input = ruleToAlertInput(makeRule({ channel: 'both' }));
    expect(input).toEqual({
      productId: 'prod-1',
      alertType: 'price_drop',
      conditionValue: 800,
      channel: 'both',
    });
  });

  it('keeps push as push', () => {
    expect(ruleToAlertInput(makeRule({ channel: 'push' }))?.channel).toBe('push');
  });

  it('cannot link a rule whose product never resolved to an id', () => {
    expect(ruleToAlertInput(makeRule({ productId: null }))).toBeNull();
  });
});

describe('rule trigger boundary', () => {
  it('fires exactly at the target price, never above it', () => {
    const rule = makeRule();
    expect(ruleMatchesPrice(rule, 800)).toBe(true);
    expect(ruleMatchesPrice(rule, 800.01)).toBe(false);
  });

  it('an inactive rule still reports its paused state', () => {
    expect(describeRule(makeRule({ active: false }), 700)).toMatch(/Paused/);
  });
});

describe('rule input validation for the API', () => {
  it('accepts slug-based and id-based rules', () => {
    expect(
      validateRuleInput({ productSlug: 'macbook-air-13', targetPriceUsd: 800 }).ok
    ).toBe(true);
    expect(validateRuleInput({ productId: 'prod-1', targetPriceUsd: 800 }).ok).toBe(true);
  });

  it('rejects empty slugs and empty ids', () => {
    expect(validateRuleInput({ productSlug: '   ', targetPriceUsd: 800 }).ok).toBe(false);
    expect(validateRuleInput({ productId: '   ', targetPriceUsd: 800 }).ok).toBe(false);
  });
});
