'use client';

/**
 * Tools-hub chrome (Section 14, I-4): the language-dependent
 * strings on /tools live in lib/i18n.ts (toolsHub* keys) and render
 * through tFor here, following the HeroCopy pattern — the hub page
 * itself stays a server component and passes TOOL_GROUPS down as
 * props. Tool names and descriptions stay English (not in the
 * dictionary): they are product copy, not chrome.
 */

import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { tFor, type DictKey } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';

export type ToolsHubGroup = {
  headingKey: DictKey;
  tools: Array<{
    name: string;
    href: string;
    description: string;
    isNew?: boolean;
  }>;
};

export function ToolsHubContent({ groups }: { groups: ToolsHubGroup[] }) {
  const { language } = useRegion();
  return (
    <main className="container mx-auto flex-1 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Wrench className="h-7 w-7 text-blue-600" />{' '}
          {tFor(language, 'toolsHubTitle')}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {tFor(language, 'toolsHubIntro')}
        </p>

        {groups.map((group) => (
          <section key={group.headingKey} className="mt-10">
            <h2 className="text-xl font-semibold">
              {tFor(language, group.headingKey)}
            </h2>
            <div className="mt-4 space-y-4">
              {group.tools.map((tool) => (
                <article key={tool.href} className="rounded-lg border p-6">
                  <h3 className="text-lg font-semibold">
                    <Link
                      href={tool.href}
                      className="underline-offset-4 hover:underline"
                    >
                      {tool.name}
                    </Link>{' '}
                    {tool.isNew ? (
                      <span className="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 align-middle text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {tFor(language, 'toolsHubNew')}
                      </span>
                    ) : null}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tool.description}
                  </p>
                  <Link
                    href={tool.href}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    {tFor(language, 'toolsHubOpenTool')} →
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ))}

        <p className="mt-8 text-sm text-muted-foreground">
          {tFor(language, 'toolsHubBlockedNote')}
        </p>

        {/* Roadmap hub (Section 11): what is coming next, with
            honest status per item and no fake dates. Separate
            from the "Future AI" group above, which lists tools
            that are already built. */}
        <div className="mt-8 rounded-lg border p-6">
          <h2 className="text-lg font-semibold">
            {tFor(language, 'toolsHubComingNext')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tFor(language, 'toolsHubComingNextText')}
          </p>
          <Link
            href="/coming-soon"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {tFor(language, 'toolsHubSeeRoadmap')} →
          </Link>
        </div>
      </div>
    </main>
  );
}
