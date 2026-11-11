/**
 * Supply Chain Block (Section 6, item 11).
 *
 * Props-driven, standalone: the wave-2 integrator mounts this on
 * the product page with the `supplyChain` key from the product API.
 * Only recorded facts are shown; any missing field reads
 * "Not recorded". A country of origin or certification is never
 * estimated.
 */
import { Factory } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  formatSupplyChainFacts,
  type SupplyChainData,
} from '@/lib/supply-chain';

export interface SupplyChainBlockProps {
  /** Recorded supply-chain data from the product API (`supplyChain` key), or null. */
  supplyChain: SupplyChainData | null | undefined;
}

export function SupplyChainBlock({ supplyChain }: SupplyChainBlockProps) {
  const facts = formatSupplyChainFacts(supplyChain);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Factory className="h-5 w-5 text-muted-foreground" />
          Supply chain
        </CardTitle>
        <CardDescription>
          Recorded origin, manufacturer &amp; certifications (recorded data only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!facts ? (
          <p className="text-sm text-muted-foreground">
            No supply-chain facts recorded for this product yet. Origin and
            certifications are never estimated.
          </p>
        ) : (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Country of origin</dt>
              <dd className="text-right font-medium">{facts.countryOfOrigin}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Manufacturer</dt>
              <dd className="text-right font-medium">{facts.manufacturerName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Certifications</dt>
              <dd className="text-right font-medium">{facts.certifications.join(', ')}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Note</dt>
              <dd className="text-right font-medium">{facts.note}</dd>
            </div>
            {facts.sourceUrl && (
              <div className="pt-1">
                <a
                  href={facts.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline hover:text-blue-800"
                >
                  Source: manufacturer / brand page
                </a>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
