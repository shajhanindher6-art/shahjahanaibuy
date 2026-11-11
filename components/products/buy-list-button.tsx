/**
 * Buy-list button (Section 6, Item 1 — trimmed; Section 14, Chunk 7
 * guest path + POST field fix).
 *
 * Adds this product (and optionally one merchant listing) to the
 * signed-in user's buy-list shortlist via POST /api/v1/buy-list.
 * This is a SHORTLIST, not a checkout: the user still checks out at
 * the retailer via the Where-to-Buy link. Prices are never stored
 * here — the API re-reads them at view time.
 *
 * States: idle → adding → added (dedupe: adding again bumps the
 * quantity server-side). 401 → the product is saved to the guest
 * buy list on this device instead (lib/guest-buy-list.ts) and the
 * button says so honestly — "Saved on this device — sign in to
 * keep it"; the sign-in merge (lib/guest-merge.ts) carries it into
 * the account later. Any other failure → retry message, never a
 * silent success.
 *
 * POST field fix (Section 14): the API reads camelCase productId /
 * merchantProductId — the button used to send snake_case product_id
 * / merchant_product_id, which the API ignored and answered 400
 * ("productId is required") for every signed-in save.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addGuestBuyListItem } from '@/lib/guest-buy-list';

export interface BuyListButtonProps {
  /** Product id (products.id). */
  productId: string;
  /** Merchant listing id (merchant_products.id), or null for the product alone. */
  merchantProductId?: string | null;
  /** Product name — needed for the guest (device) save path. */
  productName?: string;
  /** Product slug — needed for the guest (device) save path. */
  productSlug?: string;
}

export function BuyListButton({ productId, merchantProductId = null, productName, productSlug }: BuyListButtonProps) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error' | 'signin' | 'saved-device'>('idle');

  async function handleClick() {
    if (state === 'adding' || state === 'added' || state === 'saved-device') return;
    setState('adding');
    try {
      const res = await fetch('/api/v1/buy-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          merchantProductId,
          quantity: 1,
        }),
      });
      if (res.status === 401) {
        // Guest: save on this device when the name/slug are known;
        // otherwise fall back to the sign-in prompt.
        if (productName && productSlug) {
          addGuestBuyListItem({ id: productId, slug: productSlug, name: productName });
          setState('saved-device');
        } else {
          setState('signin');
        }
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

  if (state === 'saved-device') {
    return (
      <Button asChild variant="outline" size="sm" title="Saved on this device — sign in to keep it across devices">
        <Link href="/sign-in">
          <Check className="mr-1 h-4 w-4" /> Saved on this device
        </Link>
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
