/**
 * BNPL line (Section 6, item 9).
 *
 * Props-driven, standalone: the wave-2 integrator mounts this on the
 * product page with the current price and the store of the selected
 * merchant listing. It NEVER invents terms, APRs, or fees — a BNPL
 * line appears only when the store carries a VERIFIED `bnpl` payment
 * method (see lib/local-payments.ts), and the monthly figure comes
 * only from monthlyInstalment() over recorded inputs.
 */
import { CreditCard } from 'lucide-react';
import {
  getBnplMethodForStore,
  monthlyInstalment,
} from '@/lib/local-payments';
import type { LocalStore } from '@/lib/stores';

export interface BnplLineProps {
  /** Store of the selected merchant listing (verified methods only). */
  store: LocalStore | null | undefined;
  /** Current recorded total price in USD. */
  totalUsd: number | null | undefined;
  /** Instalment term in months, when the retailer records one. */
  months?: number | null;
  /** APR percent, when the retailer records one. Null = unknown. */
  aprPct?: number | null;
}

export function BnplLine({ store, totalUsd, months = null, aprPct = null }: BnplLineProps) {
  const method = store ? getBnplMethodForStore(store) : null;
  const instalment = method ? monthlyInstalment(totalUsd, months, aprPct) : null;
  const termMonths = months !== null && months !== undefined && Number.isFinite(months) ? Math.floor(months) : null;

  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {!method ? (
          <>Buy now, pay later: not verified for this store.</>
        ) : !instalment || termMonths === null ? (
          <>
            {method.label}
            {method.detail ? ` — ${method.detail}` : ''} — instalment terms not
            recorded. Retailer confirms APR at checkout.
          </>
        ) : (
          <>
            {method.label}: ${instalment.monthlyUsd.toFixed(2)}/month for{' '}
            {termMonths} month{termMonths === 1 ? '' : 's'} — {instalment.note}
          </>
        )}
      </span>
    </p>
  );
}
