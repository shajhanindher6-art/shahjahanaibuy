/**
 * Buy-list button (Section 6, Item 1 — trimmed).
 *
 * Adds this product (and optionally one merchant listing) to the
 * signed-in user's buy-list shortlist via POST /api/v1/buy-list.
 * This is a SHORTLIST, not a checkout: the user still checks out at
 * the retailer via the Where-to-Buy link. Prices are never stored
 * here — the API re-reads them at view time.
 *
 * States: idle → adding → added (dedupe: adding again bumps the
 * quantity server-side). 401 → "Sign in to save". Any other failure
 * → retry message, never a silent success.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface BuyListButtonProps {
  /** Product id (products.id). */
  productId: string;
  /** Merchant listing id (merchant_products.id), or null for the product alone. */
  merchantProductId?: string | null;
}

export function BuyListButton({ productId, merchantProductId = null }: BuyListButtonProps) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error' | 'signin'>('idle');

  async function handleClick() {
    if (state === 'adding' || state === 'added') return;
    setState('adding');
    try {
      const res = await fetch('/api/v1/buy-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          merchant_product_id: merchantProductId,
          quantity: 1,
        }),
      });
      if (res.status === 401) {
        setState('signin');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('added');
    } catch {
      setState('error');
    }
  }

  if (state === 'signin') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/sign-in">Sign in to save</Link>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={state === 'adding' || state === 'added'}
      title="Save to your buy-list shortlist — checkout still happens at the retailer"
    >
      {state === 'added' ? (
        <>
          <Check className="mr-1 h-4 w-4" /> Saved
        </>
      ) : state === 'error' ? (
        <>Could not save — try again</>
      ) : (
        <>
          <ShoppingCart className="mr-1 h-4 w-4" />
          {state === 'adding' ? 'Saving…' : 'Save'}
        </>
      )}
    </Button>
  );
}
