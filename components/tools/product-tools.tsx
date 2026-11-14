/**
 * ProductTools — "Tools for this product" block
 * (Master Tool Integration, Stage 3, S3-2).
 *
 * Links a product into the tools that can act on it, using the
 * Stage-1 link builders from services/tool-integration.ts — every
 * link carries the product in the destination tool's own dialect
 * (?product=, ?current= on T1, ?device= on T10; /compare takes
 * the product id when known, else the bare picker). Persona Fit
 * and Price-Match take no product param, so their links carry
 * their own dialect (bare here — no persona/budget is known on
 * a product page).
 *
 * Takes resolved products (slug + name + optional id) as props,
 * so the component never fetches: the product page passes one
 * product, /compare passes the compared products. Pure links
 * only — no behaviour change to either page.
 */

import Link from 'next/link';
import {
  compareLink,
  compatibilityLink,
  dealStackerLink,
  energyCostLink,
  negotiationLink,
  ownItLink,
  personaFitLink,
  priceMatchLink,
  refurbishedLink,
  repairabilityLink,
  upgradeAdvisorLink,
} from '@/services/tool-integration';

export interface ProductToolsProduct {
  slug: string;
  name: string;
  /** Product UUID for the /compare link; bare /compare without it. */
  id?: string | null;
}

function linksForProduct(product: ProductToolsProduct): Array<{ href: string; label: string }> {
  const slug = product.slug;
  return [
    { href: upgradeAdvisorLink(slug), label: 'Is this an upgrade?' },
    { href: compatibilityLink(slug), label: 'Check compatibility' },
    { href: energyCostLink(slug), label: 'Calculate total energy cost' },
    { href: dealStackerLink(slug), label: 'Stack this deal' },
    { href: negotiationLink(slug), label: 'Negotiate this price' },
    { href: repairabilityLink(slug), label: 'Check repairability' },
    { href: refurbishedLink(slug), label: 'Refurbished buying checklist' },
    { href: ownItLink(slug), label: 'Do I already own this?' },
    { href: priceMatchLink(), label: 'Check the price-match policy' },
    { href: personaFitLink(), label: 'Find your persona fit' },
    {
      href: product.id ? compareLink([product.id]) : compareLink([]),
      label: 'Compare products',
    },
  ];
}

export function ProductTools({
  products,
}: {
  products: ProductToolsProduct[];
}): JSX.Element | null {
  if (products.length === 0) return null;
  const showNames = products.length > 1;
  return (
    <section
      aria-labelledby="tools-for-this-product"
      className="mt-10 rounded-lg border p-6"
    >
      <h2 id="tools-for-this-product" className="text-xl font-semibold">
        {showNames ? 'Tools for these products' : 'Tools for this product'}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Open any of these tools with this product already picked —
        the product travels with the link.
      </p>
      {products.map((product) => (
        <div key={product.slug} className="mt-4">
          {showNames && <h3 className="font-semibold">{product.name}</h3>}
          <ul className="mt-2 space-y-2">
            {linksForProduct(product).map((link) => (
              <li key={`${product.slug}::${link.href}::${link.label}`}>
                <Link
                  href={link.href}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {link.label} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
