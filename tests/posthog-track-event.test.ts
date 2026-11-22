// @vitest-environment node
/**
 * PostHog 5-event analytics — central tracker unit tests.
 *
 * The tracker (components/analytics/track-event.ts) is the ONLY place
 * custom events are sent, so its safety rules are pinned here:
 * - fires only when analytics consent is 'granted' AND PostHog is
 *   initialized (never a second instance — it never calls init);
 * - silent no-op on denied/unknown consent and on an uninitialized
 *   client;
 * - never throws, even when posthog.capture() itself throws, so a
 *   tracking failure can never interrupt the user's action;
 * - forwards exactly the props it is given (no extra keys added).
 *
 * The real posthog-js client is never loaded here (node env has no
 * window): it is mocked, as are the consent reader and the provider's
 * initialized flag.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  getAnalyticsConsent: vi.fn(),
  isPosthogInitialized: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: { capture: mocks.capture },
}));

vi.mock('@/lib/consent', () => ({
  getAnalyticsConsent: mocks.getAnalyticsConsent,
}));

vi.mock('@/components/analytics/posthog-provider', () => ({
  isPosthogInitialized: mocks.isPosthogInitialized,
}));

import { trackEvent } from '@/components/analytics/track-event';

describe('trackEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the happy path (granted + initialized).
    mocks.getAnalyticsConsent.mockReturnValue('granted');
    mocks.isPosthogInitialized.mockReturnValue(true);
  });

  it('fires the event with exactly the given props when consent is granted and PostHog is initialized', () => {
    trackEvent('user_signed_up', { method: 'email', success: true });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('user_signed_up', {
      method: 'email',
      success: true,
    });
  });

  it('fires each of the five event names', () => {
    trackEvent('user_signed_up', { method: 'email', success: true });
    trackEvent('user_logged_in', { method: 'email', success: true });
    trackEvent('product_searched', { results_count: 3 });
    trackEvent('product_added_to_wishlist', { source: 'product_page' });
    trackEvent('price_alert_created', { alert_type: 'price_drop' });
    expect(mocks.capture).toHaveBeenCalledTimes(5);
    expect(mocks.capture).toHaveBeenNthCalledWith(1, 'user_signed_up', {
      method: 'email',
      success: true,
    });
    expect(mocks.capture).toHaveBeenNthCalledWith(2, 'user_logged_in', {
      method: 'email',
      success: true,
    });
    expect(mocks.capture).toHaveBeenNthCalledWith(3, 'product_searched', {
      results_count: 3,
    });
    expect(mocks.capture).toHaveBeenNthCalledWith(
      4,
      'product_added_to_wishlist',
      { source: 'product_page' }
    );
    expect(mocks.capture).toHaveBeenNthCalledWith(5, 'price_alert_created', {
      alert_type: 'price_drop',
    });
  });

  it('sends nothing when analytics consent is denied', () => {
    mocks.getAnalyticsConsent.mockReturnValue('denied');
    trackEvent('user_logged_in', { method: 'email', success: true });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('sends nothing when analytics consent has not been chosen yet (unknown)', () => {
    mocks.getAnalyticsConsent.mockReturnValue('unknown');
    trackEvent('product_searched', { results_count: 1 });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('sends nothing when PostHog is not initialized, even with consent granted', () => {
    mocks.isPosthogInitialized.mockReturnValue(false);
    trackEvent('user_signed_up', { method: 'email', success: true });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('never throws when posthog.capture() throws — the caller action must not break', () => {
    mocks.capture.mockImplementation(() => {
      throw new Error('posthog unavailable');
    });
    expect(() =>
      trackEvent('product_added_to_wishlist', { source: 'search_results' })
    ).not.toThrow();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it('never throws when the consent reader throws', () => {
    mocks.getAnalyticsConsent.mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });
    expect(() =>
      trackEvent('price_alert_created', { alert_type: 'deal' })
    ).not.toThrow();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('forwards only the props it is given — it adds no extra keys', () => {
    trackEvent('product_searched', { results_count: 7 });
    const props = mocks.capture.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['results_count']);
  });

  it('works with no props at all', () => {
    trackEvent('user_logged_in');
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('user_logged_in', undefined);
  });
});
