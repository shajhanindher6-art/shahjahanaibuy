import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_ALERTS_STORAGE_KEY,
  MAX_LOCAL_ALERTS,
  listLocalAlertsForProduct,
  loadLocalAlerts,
  removeLocalAlert,
  saveLocalAlert,
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

function saveValid(overrides: { productId?: string; targetPrice?: number } = {}) {
  return saveLocalAlert({
    productId: overrides.productId ?? 'prod-1',
    productName: 'MacBook Air 13',
    targetPrice: overrides.targetPrice ?? 899,
  });
}

describe('saveLocalAlert', () => {
  it('saves a valid alert with id, channel local and ISO createdAt', () => {
    const result = saveValid();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.id.length).toBeGreaterThan(0);
    expect(result.alert.productId).toBe('prod-1');
    expect(result.alert.productName).toBe('MacBook Air 13');
    expect(result.alert.targetPrice).toBe(899);
    expect(result.alert.alertType).toBe('price_drop');
    expect(result.alert.channel).toBe('local');
    expect(Number.isNaN(Date.parse(result.alert.createdAt))).toBe(false);
    expect(loadLocalAlerts()).toHaveLength(1);
  });

  it('rejects a target price of 0 or below and stores nothing', () => {
    expect(saveValid({ targetPrice: 0 }).ok).toBe(false);
    expect(saveValid({ targetPrice: -50 }).ok).toBe(false);
    expect(loadLocalAlerts()).toHaveLength(0);
  });

  it('rejects NaN and Infinity targets and stores nothing', () => {
    expect(saveValid({ targetPrice: Number.NaN }).ok).toBe(false);
    expect(saveValid({ targetPrice: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(loadLocalAlerts()).toHaveLength(0);
  });

  it('caps stored alerts at 20 — the 21st save drops the oldest', () => {
    const first = saveValid({ targetPrice: 100 });
    expect(first.ok).toBe(true);
    for (let i = 0; i < MAX_LOCAL_ALERTS; i++) {
      expect(saveValid({ targetPrice: 200 + i }).ok).toBe(true);
    }
    const alerts = loadLocalAlerts();
    expect(alerts).toHaveLength(MAX_LOCAL_ALERTS);
    if (first.ok) {
      expect(alerts.some((a) => a.id === first.alert.id)).toBe(false);
    }
    expect(alerts[alerts.length - 1].targetPrice).toBe(200 + MAX_LOCAL_ALERTS - 1);
  });

  it('returns ok:false (never throws) when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveValid()).not.toThrow();
    expect(saveValid().ok).toBe(false);
  });
});

describe('loadLocalAlerts', () => {
  it('returns [] when storage is empty', () => {
    expect(loadLocalAlerts()).toEqual([]);
  });

  it('returns [] for corrupt stored JSON, never throws', () => {
    globalThis.localStorage.setItem(LOCAL_ALERTS_STORAGE_KEY, '{not json');
    expect(() => loadLocalAlerts()).not.toThrow();
    expect(loadLocalAlerts()).toEqual([]);
  });

  it('returns [] for a non-array stored payload', () => {
    globalThis.localStorage.setItem(
      LOCAL_ALERTS_STORAGE_KEY,
      JSON.stringify({ id: 'x' })
    );
    expect(loadLocalAlerts()).toEqual([]);
  });

  it('returns [] when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => loadLocalAlerts()).not.toThrow();
    expect(loadLocalAlerts()).toEqual([]);
  });
});

describe('removeLocalAlert / listLocalAlertsForProduct', () => {
  it('removes by id and returns the remaining list', () => {
    const first = saveValid({ targetPrice: 800 });
    saveValid({ targetPrice: 850 });
    expect(loadLocalAlerts()).toHaveLength(2);
    if (!first.ok) return;
    const remaining = removeLocalAlert(first.alert.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].targetPrice).toBe(850);
    expect(loadLocalAlerts()).toHaveLength(1);
  });

  it('removing an unknown id is a no-op', () => {
    saveValid();
    expect(removeLocalAlert('no-such-id')).toHaveLength(1);
  });

  it('list filters by productId', () => {
    saveValid({ productId: 'prod-1', targetPrice: 800 });
    saveValid({ productId: 'prod-2', targetPrice: 700 });
    saveValid({ productId: 'prod-1', targetPrice: 750 });
    const forProd1 = listLocalAlertsForProduct('prod-1');
    expect(forProd1).toHaveLength(2);
    expect(forProd1.map((a) => a.targetPrice)).toEqual([800, 750]);
    expect(listLocalAlertsForProduct('prod-2')).toHaveLength(1);
    expect(listLocalAlertsForProduct('prod-unknown')).toEqual([]);
  });
});
