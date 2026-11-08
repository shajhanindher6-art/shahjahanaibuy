import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOwnVaultProductIds,
  hasVaultReceiptForProduct,
  isOwnVerifiedReview,
} from '@/services/verified-buyer';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as unknown as Response;
}

describe('hasVaultReceiptForProduct', () => {
  it('matches a receipt for the same product id', () => {
    expect(
      hasVaultReceiptForProduct(
        [{ product_id: 'other' }, { product_id: 'prod-1' }],
        'prod-1'
      )
    ).toBe(true);
  });

  it('returns false with no matching receipt, empty, null, or bad input', () => {
    expect(hasVaultReceiptForProduct([{ product_id: 'other' }], 'prod-1')).toBe(false);
    expect(hasVaultReceiptForProduct([], 'prod-1')).toBe(false);
    expect(hasVaultReceiptForProduct(null, 'prod-1')).toBe(false);
    expect(hasVaultReceiptForProduct(undefined, 'prod-1')).toBe(false);
    expect(hasVaultReceiptForProduct([{ product_id: null }], 'prod-1')).toBe(false);
    expect(hasVaultReceiptForProduct([{ product_id: 'prod-1' }], '')).toBe(false);
  });
});

describe('isOwnVerifiedReview', () => {
  it('is true only for the viewer’s own review with a receipt', () => {
    expect(
      isOwnVerifiedReview({
        reviewUserId: 'user-1',
        viewerUserId: 'user-1',
        viewerHasReceipt: true,
      })
    ).toBe(true);
  });

  it('is false for another reviewer, without a receipt, logged out, or unknown author', () => {
    const base = {
      reviewUserId: 'user-1',
      viewerUserId: 'user-1',
      viewerHasReceipt: true,
    };
    expect(isOwnVerifiedReview({ ...base, reviewUserId: 'user-2' })).toBe(false);
    expect(isOwnVerifiedReview({ ...base, viewerHasReceipt: false })).toBe(false);
    expect(isOwnVerifiedReview({ ...base, viewerUserId: null })).toBe(false);
    expect(isOwnVerifiedReview({ ...base, viewerUserId: undefined })).toBe(false);
    expect(isOwnVerifiedReview({ ...base, reviewUserId: null })).toBe(false);
  });
});

describe('fetchOwnVaultProductIds', () => {
  it('returns the viewer’s receipt product ids when the vault answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          success: true,
          data: [{ product_id: 'prod-1' }, { product_id: 'prod-2' }, { product_id: null }],
          meta: { vaultEnabled: true },
        })
      )
    );
    const result = await fetchOwnVaultProductIds();
    expect([...result.productIds].sort()).toEqual(['prod-1', 'prod-2']);
    expect(result.vaultEnabled).toBe(true);
  });

  it('resolves to an empty set on 401, on non-OK, and on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await fetchOwnVaultProductIds()).toEqual({
      productIds: new Set(),
      vaultEnabled: false,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    expect(await fetchOwnVaultProductIds()).toEqual({
      productIds: new Set(),
      vaultEnabled: false,
    });
  });
});
