import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isValidEmail,
  submitGuestEmailAlert,
  shouldTriggerGuestAlert,
  saveLocalAlert,
  loadLocalAlerts,
} from '@/lib/local-alerts';

/** In-memory localStorage stand-in (vitest runs in a Node environment). */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guest email validation', () => {
  it('accepts ordinary addresses and rejects malformed ones', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('  user+tag@example.co.uk  ')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });
});

describe('submitGuestEmailAlert', () => {
  it('posts the alert and reports success without claiming delivery', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { subscribed: true } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitGuestEmailAlert({
      email: 'user@example.com',
      productId: 'prod-1',
      alertType: 'price_drop',
      targetPrice: 899,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/alerts/guest');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.email).toBe('user@example.com');
    expect(body.productId).toBe('prod-1');
    expect(body.targetPrice).toBe(899);
  });

  it('rejects an invalid email without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await submitGuestEmailAlert({
      email: 'bad-email',
      productId: 'prod-1',
      alertType: 'price_drop',
      targetPrice: 899,
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the server error message and never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          success: false,
          error: { message: 'An alert of this type is already active' },
        }),
      }))
    );
    const result = await submitGuestEmailAlert({
      email: 'user@example.com',
      productId: 'prod-1',
      alertType: 'back_in_stock',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already active');
    }
  });

  it('returns a failure result when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const result = await submitGuestEmailAlert({
      email: 'user@example.com',
      productId: 'prod-1',
      alertType: 'deal',
    });
    expect(result.ok).toBe(false);
  });
});

describe('shouldTriggerGuestAlert', () => {
  it('fires a price_drop only at/below target and once per price', () => {
    const alert = {
      alertType: 'price_drop' as const,
      targetPrice: 900,
      lastTriggeredPrice: null,
      lastTriggeredAt: null,
    };
    expect(
      shouldTriggerGuestAlert(alert, { price: 950, backInStock: false, hasActiveDeal: false })
    ).toBe(false);
    expect(
      shouldTriggerGuestAlert(alert, { price: 900, backInStock: false, hasActiveDeal: false })
    ).toBe(true);
    expect(
      shouldTriggerGuestAlert(
        { ...alert, lastTriggeredPrice: 899 },
        { price: 899, backInStock: false, hasActiveDeal: false }
      )
    ).toBe(false);
    expect(
      shouldTriggerGuestAlert(
        { ...alert, lastTriggeredPrice: 899 },
        { price: 850, backInStock: false, hasActiveDeal: false }
      )
    ).toBe(true);
  });

  it('never fires a price_drop without a recorded price', () => {
    expect(
      shouldTriggerGuestAlert(
        { alertType: 'price_drop', targetPrice: 900, lastTriggeredPrice: null, lastTriggeredAt: null },
        { price: null, backInStock: false, hasActiveDeal: false }
      )
    ).toBe(false);
  });

  it('fires back_in_stock only on a recorded transition', () => {
    const alert = {
      alertType: 'back_in_stock' as const,
      targetPrice: null,
      lastTriggeredPrice: null,
      lastTriggeredAt: null,
    };
    // Recorded out→in transition → fires.
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        backInStockTransition: true,
        hasActiveDeal: false,
      })
    ).toBe(true);
    // In stock right now but NO recorded transition → never fires
    // (§12 #67 — a product that never left stock must not refire
    // on every refresh run).
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        backInStockTransition: false,
        hasActiveDeal: false,
      })
    ).toBe(false);
    expect(
      shouldTriggerGuestAlert(alert, {
        price: 999,
        backInStock: true,
        hasActiveDeal: false,
      })
    ).toBe(false);
    expect(
      shouldTriggerGuestAlert(alert, { price: 999, backInStock: false, hasActiveDeal: false })
    ).toBe(false);
  });

  it('fires a deal alert at most once per 24h', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const alert = {
      alertType: 'deal' as const,
      targetPrice: null,
      lastTriggeredPrice: null,
      lastTriggeredAt: null,
    };
    expect(
      shouldTriggerGuestAlert(alert, { price: null, backInStock: false, hasActiveDeal: true, now })
    ).toBe(true);
    expect(
      shouldTriggerGuestAlert(alert, { price: null, backInStock: false, hasActiveDeal: false, now })
    ).toBe(false);
    const recent = { ...alert, lastTriggeredAt: '2026-11-10T06:00:00Z' };
    expect(
      shouldTriggerGuestAlert(recent, { price: null, backInStock: false, hasActiveDeal: true, now })
    ).toBe(false);
    const old = { ...alert, lastTriggeredAt: '2026-11-09T11:00:00Z' };
    expect(
      shouldTriggerGuestAlert(old, { price: null, backInStock: false, hasActiveDeal: true, now })
    ).toBe(true);
  });
});

describe('guest back-in-stock local alerts', () => {
  it('saves a back_in_stock alert with a null target', () => {
    const result = saveLocalAlert({
      productId: 'prod-1',
      productName: 'MacBook Air 13',
      alertType: 'back_in_stock',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alert.alertType).toBe('back_in_stock');
      expect(result.alert.targetPrice).toBeNull();
    }
    expect(loadLocalAlerts()).toHaveLength(1);
  });

  it('still requires a target price for price_drop alerts', () => {
    const result = saveLocalAlert({
      productId: 'prod-1',
      productName: 'MacBook Air 13',
      alertType: 'price_drop',
    });
    expect(result.ok).toBe(false);
  });
});
