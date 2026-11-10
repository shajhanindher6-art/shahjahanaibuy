import { describe, expect, it } from 'vitest';
import {
  buildPendingConfirmation,
  isValidDeviceLabel,
  isValidProductSlug,
  isValidTrigger,
  matchSmartHomeRule,
  verifySmartHomeWebhookSignature,
  type SmartHomeRule,
} from '@/lib/smart-home-agent';
import { hashGenericWebhookSecret, signGenericWebhookPayload } from '@/lib/generic-webhook';

function rule(overrides: Partial<SmartHomeRule> = {}): SmartHomeRule {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    device_label: 'Office Printer',
    product_slug: 'printer-ink-black',
    trigger: 'ink_low',
    auto_order: false,
    requires_confirmation: true,
    is_active: true,
    created_at: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('verifySmartHomeWebhookSignature', () => {
  const secretHash = hashGenericWebhookSecret('test-shared-secret-1234');
  const body = JSON.stringify({ device_label: 'Office Printer', trigger: 'ink_low' });
  const good = signGenericWebhookPayload(secretHash, body);

  it('accepts a signature produced by the generic-webhook signer', () => {
    expect(verifySmartHomeWebhookSignature(secretHash, body, good)).toBe(true);
  });

  it('rejects a tampered body, a wrong signature and a missing signature', () => {
    expect(
      verifySmartHomeWebhookSignature(secretHash, body + ' ', good)
    ).toBe(false);
    expect(verifySmartHomeWebhookSignature(secretHash, body, '0'.repeat(64))).toBe(false);
    expect(verifySmartHomeWebhookSignature(secretHash, body, null)).toBe(false);
    expect(verifySmartHomeWebhookSignature(secretHash, body, '')).toBe(false);
  });

  it('rejects a signature for a different secret', () => {
    const otherHash = hashGenericWebhookSecret('a-different-secret-1234');
    expect(verifySmartHomeWebhookSignature(otherHash, body, good)).toBe(false);
  });
});

describe('matchSmartHomeRule', () => {
  it('matches an active rule on device label + trigger', () => {
    const found = matchSmartHomeRule([rule()], 'Office Printer', 'ink_low');
    expect(found?.id).toBe('rule-1');
  });

  it('matches case-insensitively and ignores surrounding spaces', () => {
    expect(matchSmartHomeRule([rule()], '  office printer ', 'INK_LOW')?.id).toBe('rule-1');
  });

  it('skips inactive rules and non-matching triggers', () => {
    expect(matchSmartHomeRule([rule({ is_active: false })], 'Office Printer', 'ink_low')).toBeNull();
    expect(matchSmartHomeRule([rule()], 'Office Printer', 'paper_low')).toBeNull();
    expect(matchSmartHomeRule([rule()], 'Kitchen Printer', 'ink_low')).toBeNull();
    expect(matchSmartHomeRule([], 'Office Printer', 'ink_low')).toBeNull();
  });
});

describe('buildPendingConfirmation', () => {
  it('creates a pending confirmation — never an order', () => {
    const confirmation = buildPendingConfirmation({
      rule: rule(),
      trigger: 'ink_low',
      receivedAt: new Date('2026-11-10T10:00:00.000Z'),
    });
    expect(confirmation.status).toBe('pending_confirmation');
    expect(confirmation.deviceLabel).toBe('Office Printer');
    expect(confirmation.productSlug).toBe('printer-ink-black');
    expect(confirmation.productUrl).toBe('/products/printer-ink-black');
    expect(confirmation.persisted).toBe(false);
    expect(confirmation.note).toContain('no order was placed');
  });

  it('says auto-order only prepares the reorder, still with no charge', () => {
    const confirmation = buildPendingConfirmation({
      rule: rule({ auto_order: true }),
      trigger: 'ink_low',
    });
    expect(confirmation.note).toContain('no order was placed');
    expect(confirmation.note).toContain('Confirm here first');
  });
});

describe('validators', () => {
  it('validates triggers, device labels and product slugs', () => {
    expect(isValidTrigger('ink_low')).toBe(true);
    expect(isValidTrigger('')).toBe(false);
    expect(isValidTrigger('a'.repeat(81))).toBe(false);
    expect(isValidTrigger('ink;low')).toBe(false);
    expect(isValidDeviceLabel('Office Printer')).toBe(true);
    expect(isValidDeviceLabel('  ')).toBe(false);
    expect(isValidProductSlug('printer-ink-black')).toBe(true);
    expect(isValidProductSlug('Printer Ink')).toBe(false);
    expect(isValidProductSlug('')).toBe(false);
  });
});
