/**
 * @vitest-environment jsdom
 *
 * Section 18, item 54 — global-error.tsx Sentry reporting
 * (audit §1 #74).
 *
 * `app/global-error.tsx` reports to Sentry exactly like
 * `app/error.tsx`: a DSN-guarded dynamic `captureException` in the
 * effect. Rendered with @testing-library/react (jsdom) against a
 * mocked @sentry/nextjs: capture fires when
 * NEXT_PUBLIC_SENTRY_DSN is set, never fires when it is not, and
 * the console error lands either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import GlobalError from '@/app/global-error';

const captureException = vi.mocked(Sentry.captureException);

describe('GlobalError reports to Sentry like app/error.tsx', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedDsn: string | undefined;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    captureException.mockClear();
  });

  afterEach(() => {
    // Explicit cleanup: the component renders its own <html>/<body>,
    // and auto-cleanup does not clear those renders between tests.
    cleanup();
    errorSpy.mockRestore();
    if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
  });

  it('calls captureException with the error when a DSN is configured', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    const error = new Error('root layout exploded');
    render(createElement(GlobalError, { error, reset: () => {} }));
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    expect(captureException).toHaveBeenCalledWith(error);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does NOT call captureException when Sentry is unconfigured', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const error = new Error('root layout exploded');
    render(createElement(GlobalError, { error, reset: () => {} }));
    // Let the effect + the (skipped) dynamic import settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureException).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('still renders the Try Again / Go Home actions', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    const { getByText } = render(
      createElement(GlobalError, {
        error: new Error('boom'),
        reset: () => {},
      })
    );
    expect(getByText('Try Again')).toBeTruthy();
    expect(getByText('Go Home')).toBeTruthy();
  });
});
