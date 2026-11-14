/**
 * Copy-text button — tiny client leaf (T6, /tools/negotiation-coach).
 *
 * Copies the given text to the clipboard (with a manual-copy
 * fallback: the text stays visible on the page, so a blocked
 * clipboard never hides the draft). The same clipboard pattern
 * as components/products/price-negotiator.tsx and
 * components/tools/save-calculation-button.tsx.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyTextButton({
  text,
  label = 'Copy',
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked: the text is still visible for manual copying.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" variant="outline" onClick={copy}>
      {copied ? 'Copied!' : label}
    </Button>
  );
}
