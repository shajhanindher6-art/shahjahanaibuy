// @vitest-environment jsdom
/**
 * PostHog 5-event analytics — PriceAlertDialog event tests.
 *
 * Renders `components/products/price-alert-dialog.tsx` for real in
 * jsdom. The Supabase boundary is mocked at `fetch` (the alerts
 * API), the device-local alerts are mocked at `lib/local-alerts`,
 * and the tracker is mocked so the test asserts the CALL SITE, not
 * the tracker itself (the tracker has its own unit tests).
 *
 * The component's contract, as coded:
 * - signed-in create success (POST returns success) →
 *   price_alert_created fires once, with the approved props only
 *   ({alert_type}; never a user id, product id, email, note or
 *   target price);
 * - signed-in create failure → NO event;
 * - guest device-local save success → event fires once;
 * - guest device-local save failure → NO event.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

const fakeAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

const fakeToast = vi.hoisted(() => ({
  toast: vi.fn(),
}));

const fakeLocalAlerts = vi.hoisted(() => ({
  listLocalAlertsForProduct: vi.fn(),
  removeLocalAlert: vi.fn(),
  saveLocalAlert: vi.fn(),
  submitGuestEmailAlert: vi.fn(),
  isValidEmail: vi.fn(),
}));

const fakeTrack = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return {
    Bell: stub,
    BellRing: stub,
    Trash2: stub,
    X: stub,
    Check: stub,
    ChevronDown: stub,
    ChevronUp: stub,
  };
});

vi.mock('@/features/auth', () => ({
  useAuth: () => ({ user: fakeAuth.user, isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: fakeToast.toast }),
}));

vi.mock('@/lib/local-alerts', () => ({
  listLocalAlertsForProduct: (...args: unknown[]) =>
    fakeLocalAlerts.listLocalAlertsForProduct(...args),
  removeLocalAlert: (...args: unknown[]) =>
    fakeLocalAlerts.removeLocalAlert(...args),
  saveLocalAlert: (...args: unknown[]) =>
    fakeLocalAlerts.saveLocalAlert(...args),
  submitGuestEmailAlert: (...args: unknown[]) =>
    fakeLocalAlerts.submitGuestEmailAlert(...args),
  isValidEmail: (...args: unknown[]) =>
    fakeLocalAlerts.isValidEmail(...args),
}));

vi.mock('@/lib/push-client', () => ({
  subscribeGuestPush: vi.fn().mockResolvedValue({ ok: false, reason: 'unsupported' }),
  getGuestPushToken: vi.fn().mockReturnValue(null),
}));

vi.mock('@/components/home/push-opt-in-prompt', () => ({
  PushOptInPrompt: () => null,
}));

vi.mock('@/components/analytics/track-event', () => ({
  trackEvent: (...args: unknown[]) => fakeTrack.trackEvent(...args),
}));

// Imported after the mocks so the component uses the fakes.
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('PriceAlertDialog — price_alert_created event', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.user = null;
    fakeLocalAlerts.listLocalAlertsForProduct.mockReturnValue([]);
    fakeLocalAlerts.removeLocalAlert.mockReturnValue([]);
    fakeLocalAlerts.saveLocalAlert.mockReturnValue({ ok: true });
    fakeLocalAlerts.submitGuestEmailAlert.mockResolvedValue({ ok: true });
    fakeLocalAlerts.isValidEmail.mockReturnValue(true);
    // Default fetch: the alerts list (dialog open) + a successful
    // create. Individual tests override the create response.
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/v1/alerts' && opts?.method === 'POST') {
        return jsonResponse({ success: true });
      }
      if (url === '/api/v1/alerts') {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ success: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fires price_alert_created exactly once on a signed-in create success, with approved props only', async () => {
    fakeAuth.user = { id: 'user-1' };
    render(
      createElement(PriceAlertDialog, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        currentPrice: 200,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /set alert/i }));
    await waitFor(
      () => expect(screen.getByText(/Price Alert for MacBook Air 13/)).toBeTruthy(),
      { timeout: 5000 }
    );
    // Target price (price_drop is the default type); the 90%
    // prefill also sets it, but filling explicitly is robust.
    fireEvent.change(screen.getByPlaceholderText('e.g. 199.99'), {
      target: { value: '180.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create alert/i }));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('price_alert_created', {
      alert_type: 'price_drop',
    });
    // No user id, product id, email, note or target price.
    const props = fakeTrack.trackEvent.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props)).toEqual(['alert_type']);
  });

  it('does NOT fire when the signed-in create fails', async () => {
    fakeAuth.user = { id: 'user-1' };
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/v1/alerts' && opts?.method === 'POST') {
        return jsonResponse({
          success: false,
          error: { message: 'Please try again.' },
        });
      }
      if (url === '/api/v1/alerts') {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ success: false });
    });
    render(
      createElement(PriceAlertDialog, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        currentPrice: 200,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /set alert/i }));
    await waitFor(
      () => expect(screen.getByText(/Price Alert for MacBook Air 13/)).toBeTruthy(),
      { timeout: 5000 }
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. 199.99'), {
      target: { value: '180.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create alert/i }));
    // The toast is mocked (useToast returns a vi.fn), so no toast
    // UI renders — wait for the failure toast CALL instead.
    await waitFor(
      () =>
        expect(fakeToast.toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Failed to create alert' })
        ),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });

  it('fires exactly once when a guest saves a device-local alert', async () => {
    fakeAuth.user = null;
    fakeLocalAlerts.saveLocalAlert.mockReturnValue({ ok: true });
    render(
      createElement(PriceAlertDialog, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        currentPrice: 200,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /set alert/i }));
    await waitFor(
      () => expect(screen.getByText(/Price Alert for MacBook Air 13/)).toBeTruthy(),
      { timeout: 5000 }
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. 199.99'), {
      target: { value: '180.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create alert/i }));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('price_alert_created', {
      alert_type: 'price_drop',
    });
  });

  it('does NOT fire when the guest device-local save fails', async () => {
    fakeAuth.user = null;
    fakeLocalAlerts.saveLocalAlert.mockReturnValue({
      ok: false,
      error: 'Could not save alert.',
    });
    render(
      createElement(PriceAlertDialog, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        currentPrice: 200,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /set alert/i }));
    await waitFor(
      () => expect(screen.getByText(/Price Alert for MacBook Air 13/)).toBeTruthy(),
      { timeout: 5000 }
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. 199.99'), {
      target: { value: '180.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create alert/i }));
    await waitFor(
      () => expect(fakeLocalAlerts.saveLocalAlert).toHaveBeenCalled(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });
});
