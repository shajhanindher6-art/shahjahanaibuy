'use client';

/**
 * Localised hero copy (header/hero scope of the dictionary only —
 * see lib/i18n.ts for the stated limit: the rest of the page stays
 * English). The homepage itself is a server component, so the
 * language-dependent text lives in this small client component.
 */

import Link from 'next/link';
import { ArrowRight, Check, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tFor } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';

export function HeroCopy() {
  const { language } = useRegion();
  return (
    <>
      <Badge variant="secondary" className="mb-4 gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        {tFor(language, 'heroBadge')}
      </Badge>
      <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
        {tFor(language, 'heroTitleA')}{' '}
        <span className="bg-gradient-to-r from-primary to-chart-4 bg-clip-text text-transparent">
          {tFor(language, 'heroTitleB')}
        </span>{' '}
        {tFor(language, 'heroTitleC')}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        {tFor(language, 'heroSubtitle')}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/sign-up">
            {tFor(language, 'heroCtaStart')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/search">
            <Search className="mr-2 h-4 w-4" />
            {tFor(language, 'heroCtaSearch')}
          </Link>
        </Button>
      </div>
      <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Check className="h-4 w-4 text-success" />
          {tFor(language, 'heroNoCard')}
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="h-4 w-4 text-success" />
          {tFor(language, 'heroFreeForever')}
        </span>
      </div>
    </>
  );
}
