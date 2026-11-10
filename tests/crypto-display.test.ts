import { describe, expect, it } from 'vitest';
import { formatUsdtPeg, USDT_PEG_NOTE } from '@/lib/crypto-display';

describe('formatUsdtPeg (display-only peg reference)', () => {
  it('returns the peg figure for a recorded USD price', () => {
    expect(formatUsdtPeg(999)).toBe('≈ USDT 999.00');
    expect(formatUsdtPeg(49.5)).toBe('≈ USDT 49.50');
    expect(formatUsdtPeg(0.99)).toBe('≈ USDT 0.99');
  });

  it('returns null when the price is missing, zero or negative — never a guessed peg', () => {
    expect(formatUsdtPeg(null)).toBeNull();
    expect(formatUsdtPeg(undefined)).toBeNull();
    expect(formatUsdtPeg(0)).toBeNull();
    expect(formatUsdtPeg(-10)).toBeNull();
    expect(formatUsdtPeg(Number.NaN)).toBeNull();
  });

  it('labels the peg as a reference only — not a live rate, not a payment method', () => {
    expect(USDT_PEG_NOTE).toContain('Peg reference only');
    expect(USDT_PEG_NOTE).toContain('not a live rate');
    expect(USDT_PEG_NOTE).toContain('not a payment method');
    expect(USDT_PEG_NOTE).toContain('no store is recorded as accepting crypto');
  });

  it('computes 1 USDT ≈ $1 — no FX lookup, no spread', () => {
    // The peg is the recorded USD price itself, formatted.
    expect(formatUsdtPeg(1234.56)).toBe('≈ USDT 1234.56');
  });
});
