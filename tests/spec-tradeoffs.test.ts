import { describe, expect, it } from 'vitest';
import {
  tradeoffRows,
  translateSpec,
  specTierFromAttributes,
} from '@/lib/analytics/specTradeoffs';
import type { ProductAttribute } from '@/types/catalog';

function attr(
  key: string,
  value: string,
  unit: string | null = null
): ProductAttribute {
  return {
    id: key,
    productId: 'p1',
    key,
    value,
    unit,
    group: null,
    sortOrder: 0,
  };
}

describe('translateSpec', () => {
  it('translates 16GB RAM to 4K editing (pro)', () => {
    const result = translateSpec(attr('RAM', '16', 'GB'));
    expect(result?.benefit).toContain('4K video editing');
    expect(result?.tier).toBe('pro');
  });

  it('translates 8GB RAM to everyday multitasking (balanced)', () => {
    const result = translateSpec(attr('RAM', '8', 'GB'));
    expect(result?.tier).toBe('balanced');
  });

  it('translates 512GB storage to plenty of room (balanced)', () => {
    const result = translateSpec(attr('Storage', '512', 'GB'));
    expect(result?.tier).toBe('balanced');
    expect(result?.benefit).toContain('Plenty of room');
  });

  it('translates a 100 Wh battery to a large battery (pro)', () => {
    const result = translateSpec(attr('Battery', '100', 'Wh'));
    expect(result?.tier).toBe('pro');
  });

  it('returns null for a key with no translation rule', () => {
    expect(translateSpec(attr('Color', 'Silver'))).toBeNull();
    expect(translateSpec(attr('RAM', 'unknown'))).toBeNull();
  });
});

describe('tradeoffRows and specTierFromAttributes', () => {
  it('translates only rows with a rule and keeps the stored value verbatim', () => {
    const rows = tradeoffRows([
      attr('RAM', '16', 'GB'),
      attr('Color', 'Silver'),
      attr('Storage', '512', 'GB'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].displayValue).toBe('16 GB');
    expect(rows[1].key).toBe('Storage');
  });

  it('returns [] and a null tier when nothing can be translated', () => {
    expect(tradeoffRows([])).toEqual([]);
    expect(tradeoffRows(null)).toEqual([]);
    expect(specTierFromAttributes([attr('Color', 'Silver')])).toBeNull();
  });

  it('picks the highest tier across translated rows', () => {
    expect(
      specTierFromAttributes([attr('RAM', '8', 'GB'), attr('Storage', '256', 'GB')])
    ).toBe('balanced');
    expect(specTierFromAttributes([attr('RAM', '16', 'GB')])).toBe('pro');
  });
});
