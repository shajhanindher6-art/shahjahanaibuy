import { describe, expect, it } from 'vitest';
import { formatAuthenticityBlock, AUTHENTICITY_DISCLAIMER } from '@/lib/authenticity';
import {
  formatSupplyChainFacts,
  SUPPLY_CHAIN_NOT_RECORDED,
} from '@/lib/supply-chain';

describe('formatAuthenticityBlock', () => {
  it('returns the recorded method + outbound link', () => {
    const block = formatAuthenticityBlock({
      method: 'Check the serial number on the manufacturer website.',
      url: 'https://example.com/verify',
      verifiedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(block).not.toBeNull();
    expect(block!.method).toBe('Check the serial number on the manufacturer website.');
    expect(block!.url).toBe('https://example.com/verify');
    expect(block!.verifiedAt).toBe('2026-11-10T00:00:00.000Z');
  });

  it('carries the no-verification disclaimer verbatim', () => {
    const block = formatAuthenticityBlock({ method: 'QR code scan.', url: null, verifiedAt: null });
    expect(block!.disclaimer).toBe(AUTHENTICITY_DISCLAIMER);
    expect(block!.disclaimer).toContain('SmartBuy does not verify individual units');
    expect(block!.disclaimer).not.toContain('genuine');
  });

  it('returns null when nothing is recorded — never a genuine badge', () => {
    expect(formatAuthenticityBlock(null)).toBeNull();
    expect(formatAuthenticityBlock(undefined)).toBeNull();
    expect(formatAuthenticityBlock({ method: null, url: null, verifiedAt: null })).toBeNull();
    expect(formatAuthenticityBlock({ method: '   ', url: null, verifiedAt: null })).toBeNull();
  });

  it('keeps the method even when the link is missing', () => {
    const block = formatAuthenticityBlock({ method: 'Hologram sticker.', url: '', verifiedAt: null });
    expect(block?.method).toBe('Hologram sticker.');
    expect(block?.url).toBeNull();
  });
});

describe('formatSupplyChainFacts', () => {
  it('returns only recorded fields with the source link', () => {
    const facts = formatSupplyChainFacts({
      countryOfOrigin: 'China',
      manufacturerName: 'Acme Corp',
      certifications: ['CE', 'RoHS'],
      note: 'Assembled in Shenzhen.',
      sourceUrl: 'https://example.com/supply-chain',
    });
    expect(facts).toEqual({
      countryOfOrigin: 'China',
      manufacturerName: 'Acme Corp',
      certifications: ['CE', 'RoHS'],
      note: 'Assembled in Shenzhen.',
      sourceUrl: 'https://example.com/supply-chain',
    });
  });

  it('marks each missing field "Not recorded" instead of estimating it', () => {
    const facts = formatSupplyChainFacts({
      countryOfOrigin: null,
      manufacturerName: 'Acme Corp',
      certifications: null,
      note: null,
      sourceUrl: null,
    });
    expect(facts).not.toBeNull();
    expect(facts!.countryOfOrigin).toBe(SUPPLY_CHAIN_NOT_RECORDED);
    expect(facts!.manufacturerName).toBe('Acme Corp');
    expect(facts!.certifications).toEqual([SUPPLY_CHAIN_NOT_RECORDED]);
    expect(facts!.note).toBe(SUPPLY_CHAIN_NOT_RECORDED);
    expect(facts!.sourceUrl).toBeNull();
  });

  it('returns null only when nothing at all is recorded', () => {
    expect(formatSupplyChainFacts(null)).toBeNull();
    expect(formatSupplyChainFacts(undefined)).toBeNull();
    expect(
      formatSupplyChainFacts({
        countryOfOrigin: null,
        manufacturerName: null,
        certifications: null,
        note: null,
        sourceUrl: null,
      })
    ).toBeNull();
    expect(
      formatSupplyChainFacts({
        countryOfOrigin: '   ',
        manufacturerName: null,
        certifications: [],
        note: null,
        sourceUrl: null,
      })
    ).toBeNull();
  });

  it('drops blank certifications and keeps recorded ones', () => {
    const facts = formatSupplyChainFacts({
      countryOfOrigin: null,
      manufacturerName: null,
      certifications: ['CE', '  ', ''],
      note: null,
      sourceUrl: null,
    });
    expect(facts!.certifications).toEqual(['CE']);
  });

  it('a source link alone is enough to return facts', () => {
    const facts = formatSupplyChainFacts({
      countryOfOrigin: null,
      manufacturerName: null,
      certifications: null,
      note: null,
      sourceUrl: 'https://example.com/supply-chain',
    });
    expect(facts).not.toBeNull();
    expect(facts!.sourceUrl).toBe('https://example.com/supply-chain');
  });
});
