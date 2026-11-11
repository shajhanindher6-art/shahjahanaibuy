'use client';

/**
 * Localised page heading (Section 14, I-5): server-component pages
 * cannot call tFor with the visitor's language themselves, so the
 * heading lives in this small client component, following the
 * HeroCopy pattern. The English strings are unchanged — the dict
 * values (pageHeading* keys) match the previous hardcoded text.
 */

import type { ReactNode } from 'react';
import { tFor, type DictKey } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';

export function LocalizedHeading({
  dictKey,
  className,
  icon,
}: {
  dictKey: DictKey;
  className?: string;
  icon?: ReactNode;
}) {
  const { language } = useRegion();
  return (
    <h1 className={className}>
      {icon}
      {icon ? ' ' : null}
      {tFor(language, dictKey)}
    </h1>
  );
}
