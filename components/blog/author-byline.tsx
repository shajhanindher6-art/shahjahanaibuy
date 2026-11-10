import type { Post } from '@/lib/blog/posts';

/**
 * Author byline for blog posts.
 *
 * The author is always the generic SmartBuy Editorial Team — no
 * individual person is named anywhere on the blog, and no name, bio,
 * or photo is invented here. Wave-2 wiring: app/blog/[slug]/page.tsx
 * (owned by another workstream) can render this under the article
 * title once its metadata/JSON-LD work lands.
 */
export function AuthorByline({ post }: { post: Post }) {
  const author = post.author;
  if (!author) return null;
  return (
    <div className="mt-3 rounded-lg bg-muted px-4 py-3">
      <p className="text-sm font-medium">
        By {author.name} · {author.role}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{author.bio}</p>
      {post.lastUpdated ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated{' '}
          {new Date(`${post.lastUpdated}T00:00:00Z`).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      ) : null}
    </div>
  );
}
