/**
 * RelatedTools — the ONE shared "Related tools" link block
 * (Master Tool Integration, Stage 3, S3-1).
 *
 * Data comes from services/tool-integration.ts#relatedToolLinks
 * (data-only helper); this component only renders it — never a
 * hand-rolled block per page. Every link carries the product in
 * the destination tool's own dialect (?product=, ?current= on
 * T1, ?device= on T10, persona/budget on T2, status on T3).
 * With no product the block renders bare routes / product-less
 * links, never a link with an empty or missing product.
 *
 * Server component: used by the 10 tool pages (all server
 * components). Renders nothing when the tool has no links.
 */

import Link from 'next/link';
import {
  relatedToolLinks,
  type ToolId,
} from '@/services/tool-integration';

export function RelatedTools({
  tool,
  productSlug,
}: {
  tool: ToolId | string;
  productSlug?: string | null;
}): JSX.Element | null {
  const links = relatedToolLinks(tool, productSlug ?? null);
  if (links.length === 0) return null;
  const hasProduct = productSlug !== null && productSlug !== undefined && productSlug !== '';
  return (
    <section
      aria-labelledby="related-tools"
      className="mt-10 rounded-lg border p-6"
    >
      <h2 id="related-tools" className="text-xl font-semibold">
        Related tools
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasProduct
          ? 'Continue with this product in another tool — the product travels with the link, so you never re-pick it.'
          : 'Other tools that pair with this one.'}
      </p>
      <ul className="mt-4 space-y-2">
        {links.map((link) => (
          <li key={`${link.href}::${link.label}`}>
            <Link
              href={link.href}
              className="font-medium underline-offset-4 hover:underline"
            >
              {link.label} →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
