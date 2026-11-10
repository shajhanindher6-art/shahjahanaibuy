import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardCheck } from 'lucide-react';
import { CURATION_GUIDELINES } from '@/lib/curators';

/**
 * Public curation guidelines (Section 5, item 13).
 *
 * The rules every curated slot must pass before it goes live.
 * Editorial policy, not data — shown so shoppers can see what
 * "curated" actually means on SmartBuy.
 */
export function CurationGuidelines() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-5 w-5 text-emerald-600" /> How curation works
        </CardTitle>
        <CardDescription>
          Every curated deal passes these checks. A slot that fails any of them never goes live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {CURATION_GUIDELINES.map((g) => (
            <li key={g.title} className="text-sm">
              <span className="font-medium">{g.title} — </span>
              <span className="text-muted-foreground">{g.rule}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
