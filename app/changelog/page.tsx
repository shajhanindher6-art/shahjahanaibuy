import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { RELEASES, PENDING_SYNC_RELEASES, type ChangelogRelease } from './releases';

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function ReleaseCard({ release }: { release: ChangelogRelease }) {
  return (
    <article className="rounded-lg border p-4">
      <p className="font-medium">{release.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Commit{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{release.sha.slice(0, 12)}</code>
        {' · '}
        {release.date ? formatDate(release.date) : 'Date not recorded in the sync record'}
      </p>
      {release.paths.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {release.paths.length} file{release.paths.length === 1 ? '' : 's'} changed:{' '}
          {release.paths.slice(0, 6).join(', ')}
          {release.paths.length > 6 ? `, and ${release.paths.length - 6} more` : ''}
        </p>
      ) : null}
    </article>
  );
}

export default function ChangelogPage() {
  const dated = RELEASES.filter((r) => r.date).sort((a, b) =>
    (a.date ?? '') < (b.date ?? '') ? 1 : -1,
  );
  const undated = RELEASES.filter((r) => !r.date);
  const datedGroups = new Map<string, ChangelogRelease[]>();
  for (const release of dated) {
    const group = datedGroups.get(release.date ?? '') ?? [];
    group.push(release);
    datedGroups.set(release.date ?? '', group);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Changelog</h1>
          <p className="mt-2 text-muted-foreground">
            What changed on SmartBuy AI, and when. This page is built from the real release
            record — 55 releases, each with its commit and the files it changed.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            An honest note: the release record contains commit IDs and changed files only —
            no dates and no commit messages. A date is shown below only where the project
            log confirms it; every other release is labelled &ldquo;Date not recorded in the
            sync record&rdquo;. Titles are short descriptions of what the changed files do,
            not quoted commit messages, because the record has none to quote.
          </p>

          {[...datedGroups.entries()].map(([date, releases]) => (
            <section key={date} className="mt-10">
              <h2 className="text-xl font-semibold">{formatDate(date)}</h2>
              <div className="mt-4 space-y-3">
                {releases.map((release) => (
                  <ReleaseCard key={release.sha} release={release} />
                ))}
              </div>
            </section>
          ))}

          <section className="mt-10">
            <h2 className="text-xl font-semibold">
              Earlier releases — date not recorded in the sync record
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              These releases are listed in the order the sync record holds them. Their dates
              are not recorded, so they are not placed on the timeline above.
            </p>
            <div className="mt-4 space-y-3">
              {undated.map((release) => (
                <ReleaseCard key={release.sha} release={release} />
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold">Not yet in the sync record</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              These releases are known from the project log but are not yet in the sync
              record above. They are shown separately so the record stays exactly what the
              sync file contains, and they will join the main list once the sync record
              confirms them.
            </p>
            <div className="mt-4 space-y-3">
              {PENDING_SYNC_RELEASES.map((release) => (
                <ReleaseCard key={release.sha} release={release} />
              ))}
            </div>
          </section>

          <p className="mt-8 text-sm text-muted-foreground">
            The full public repository is on GitHub:{' '}
            <a
              href="https://github.com/shajhanindher6-art/shahjahanaibuy"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              shahjahanaibuy
            </a>
            . For how features work, see the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
