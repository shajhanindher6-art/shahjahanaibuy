/**
 * Tests for the AI Trade-in & Second-hand Finder (Section 7 item 8).
 * Pure helpers + the shared Resale Predictor reuse (no duplicated
 * projection logic). DB reads are not tested here — they are
 * fail-safe by construction and covered by the route's empty-state
 * behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidProgramUrl,
  filterProgramsByCategory,
  isMissingTableError,
  buildTradeInSummary,
  TRADE_IN_EMPTY_MESSAGE,
  type TradeInProgram,
  type TradeInDirectory,
} from '@/lib/trade-in-finder';
import { predictResaleValue } from '@/services/resale-predictor';

function program(overrides: Partial<TradeInProgram> = {}): TradeInProgram {
  return {
    id: '1',
    name: 'Apple Trade In',
    retailer: 'Apple',
    url: 'https://www.apple.com/trade-in/',
    category: 'Phones',
    notes: null,
    isVerified: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const EMPTY_DIRECTORY: TradeInDirectory = {
  programs: [],
  directoryAvailable: false,
  totalPrograms: 0,
  verifiedPrograms: 0,
};

describe('isValidProgramUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidProgramUrl('https://www.apple.com/trade-in/')).toBe(true);
    expect(isValidProgramUrl('http://example.com')).toBe(true);
  });

  it('rejects null, empty and non-http(s) URLs', () => {
    expect(isValidProgramUrl(null)).toBe(false);
    expect(isValidProgramUrl('')).toBe(false);
    expect(isValidProgramUrl('javascript:alert(1)')).toBe(false);
    expect(isValidProgramUrl('not a url')).toBe(false);
  });
});

describe('filterProgramsByCategory', () => {
  it('returns all programs when no category is given', () => {
    const programs = [program(), program({ id: '2', category: 'Laptops' })];
    expect(filterProgramsByCategory(programs, null)).toHaveLength(2);
    expect(filterProgramsByCategory(programs, undefined)).toHaveLength(2);
  });

  it('filters case-insensitively', () => {
    const programs = [program(), program({ id: '2', category: 'Laptops' })];
    expect(filterProgramsByCategory(programs, 'phones')).toHaveLength(1);
    expect(filterProgramsByCategory(programs, 'Phones')[0].id).toBe('1');
  });
});

describe('isMissingTableError', () => {
  it('recognises Postgres missing-table / missing-column codes', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: '42703' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe('buildTradeInSummary', () => {
  it('says the directory is empty honestly when no programs are recorded', () => {
    expect(TRADE_IN_EMPTY_MESSAGE).toContain('No verified trade-in programs recorded yet');
    const summary = buildTradeInSummary(EMPTY_DIRECTORY, null, null);
    expect(summary.totalPrograms).toBe(0);
    expect(summary.verifiedPrograms).toBe(0);
    expect(summary.resale).toBeNull();
    expect(summary.headline).toContain('Koi product select nahi kiya');
  });

  it('ties the resale predictor value into the headline (simulated)', () => {
    const prediction = predictResaleValue(
      [
        { price: 1000, recordedAt: '2026-09-01T00:00:00Z' },
        { price: 900, recordedAt: '2026-11-01T00:00:00Z' },
      ],
      900,
      0.12
    );
    expect(prediction.status).toBe('ok');
    const summary = buildTradeInSummary(EMPTY_DIRECTORY, prediction, 'macbook-pro');
    expect(summary.headline).toContain('$');
    expect(summary.headline).toContain('Simulated');
    expect(summary.resale?.retentionPct24).toBe(prediction.retentionPct24);
  });

  it('says so honestly when the predictor has too little history', () => {
    const prediction = predictResaleValue([], 900, null);
    expect(prediction.status).toBe('insufficient');
    const summary = buildTradeInSummary(EMPTY_DIRECTORY, prediction, 'macbook-pro');
    expect(summary.headline).toContain('kaafi recorded price history nahi hai');
  });

  it('counts verified programs', () => {
    const directory: TradeInDirectory = {
      programs: [program(), program({ id: '2', isVerified: false })],
      directoryAvailable: true,
      totalPrograms: 2,
      verifiedPrograms: 1,
    };
    const summary = buildTradeInSummary(directory, null, null);
    expect(summary.totalPrograms).toBe(2);
    expect(summary.verifiedPrograms).toBe(1);
  });
});
