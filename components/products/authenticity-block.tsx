/**
 * Authenticity Block (Section 6, item 10).
 *
 * Props-driven, standalone: the wave-2 integrator mounts this on
 * the product page with the `authenticity` key from the product
 * API. It NEVER awards a "genuine" badge and never claims SmartBuy
 * verified the unit — it only repeats the manufacturer's own
 * verification method and links out to it.
 */
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  formatAuthenticityBlock,
  type AuthenticityData,
} from '@/lib/authenticity';

export interface AuthenticityBlockProps {
  /** Recorded authenticity data from the product API (`authenticity` key), or null. */
  authenticity: AuthenticityData | null | undefined;
}

export function AuthenticityBlock({ authenticity }: AuthenticityBlockProps) {
  const block = formatAuthenticityBlock(authenticity);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-slate-500" />
          Authenticity check
        </CardTitle>
        <CardDescription>
          How to verify this product with the manufacturer
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!block ? (
          <p className="text-sm text-muted-foreground">
            No authenticity verification method recorded for this product yet.
          </p>
        ) : (
          <>
            <p className="text-sm">{block.method}</p>
            {block.url && (
              <p className="text-sm">
                <a
                  href={block.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  Open the manufacturer&apos;s verification page
                </a>
              </p>
            )}
            {block.verifiedAt && (
              <p className="text-xs text-muted-foreground">
                Method recorded {new Date(block.verifiedAt).toLocaleDateString()}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{block.disclaimer}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
