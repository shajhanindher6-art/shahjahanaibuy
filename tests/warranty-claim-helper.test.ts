import { describe, expect, it } from 'vitest';
import {
  buildClaimChecklist,
  findRetailerContact,
  isValidClaimStatus,
  type VaultItemForClaim,
} from '@/lib/warranty-claim-helper';

function vaultItem(overrides: Partial<VaultItemForClaim> = {}): VaultItemForClaim {
  return {
    id: 'vault-1',
    title: 'MacBook Air M4',
    store: 'Daraz',
    product_id: 'prod-1',
    purchase_date: '2026-10-15',
    amount: 999,
    currency: 'USD',
    warranty_months: 12,
    receipt_file_name: 'receipt.pdf',
    receipt_file_type: 'application/pdf',
    receipt_file_size: 12345,
    receipt_url: null,
    created_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildClaimChecklist', () => {
  it('derives expiry from purchase date + warranty months', () => {
    const checklist = buildClaimChecklist(vaultItem(), new Date('2026-11-10T00:00:00Z'));
    expect(checklist.expiryDate).toBe('2027-10-15');
    expect(checklist.daysUntilExpiry).toBe(339);
    expect(checklist.warrantyState).toBe('active');
    expect(checklist.reminder).toBeNull();
  });

  it('flags expiring-soon within 30 days with a reminder', () => {
    const checklist = buildClaimChecklist(vaultItem(), new Date('2027-09-20T00:00:00Z'));
    expect(checklist.warrantyState).toBe('expiring_soon');
    expect(checklist.daysUntilExpiry).toBe(25);
    expect(checklist.reminder).toContain('25 din mein');
  });

  it('flags an expired warranty', () => {
    const checklist = buildClaimChecklist(vaultItem(), new Date('2027-11-01T00:00:00Z'));
    expect(checklist.warrantyState).toBe('expired');
    expect(checklist.daysUntilExpiry).toBeLessThan(0);
    expect(checklist.reminder).toContain('khatam ho chuki hai');
  });

  it('reports no warranty when warranty_months is 0', () => {
    const checklist = buildClaimChecklist(
      vaultItem({ warranty_months: 0 }),
      new Date('2026-11-10T00:00:00Z')
    );
    expect(checklist.expiryDate).toBeNull();
    expect(checklist.warrantyState).toBe('no_warranty');
  });

  it('marks the receipt document present from a saved file, missing otherwise', () => {
    const withReceipt = buildClaimChecklist(vaultItem());
    expect(withReceipt.documents.find((d) => d.key === 'receipt')?.present).toBe(true);
    const withoutReceipt = buildClaimChecklist(
      vaultItem({ receipt_file_name: null, receipt_url: null })
    );
    const doc = withoutReceipt.documents.find((d) => d.key === 'receipt');
    expect(doc?.present).toBe(false);
    expect(doc?.detail).toContain('No receipt saved');
  });

  it('marks a missing amount as not present', () => {
    const checklist = buildClaimChecklist(vaultItem({ amount: null }));
    expect(checklist.documents.find((d) => d.key === 'amount')?.present).toBe(false);
  });
});

describe('findRetailerContact', () => {
  it('returns the recorded store homepage for a directory store', () => {
    const contact = findRetailerContact('Daraz');
    expect(contact).not.toBeNull();
    expect(contact?.name).toBe('Daraz');
    expect(contact?.websiteUrl).toContain('daraz');
  });

  it('matches case-insensitively', () => {
    expect(findRetailerContact('daraz')?.name).toBe('Daraz');
  });

  it('returns null for a store that is not in the directory', () => {
    expect(findRetailerContact('Some Unknown Shop')).toBeNull();
    expect(findRetailerContact(null)).toBeNull();
    expect(findRetailerContact('')).toBeNull();
  });
});

describe('isValidClaimStatus', () => {
  it('accepts the five contract statuses and rejects the rest', () => {
    for (const status of ['not_started', 'in_progress', 'submitted', 'resolved', 'denied']) {
      expect(isValidClaimStatus(status)).toBe(true);
    }
    expect(isValidClaimStatus('approved')).toBe(false);
    expect(isValidClaimStatus('')).toBe(false);
    expect(isValidClaimStatus(null)).toBe(false);
  });
});
