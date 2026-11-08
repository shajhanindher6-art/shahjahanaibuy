/**
 * Type declarations for natural's deep file imports.
 *
 * The services import SPECIFIC natural files (never the package root and
 * never the submodule barrels — see the comments in
 * services/review-sentiment.ts and services/review-authenticity.ts for
 * why: the root and the barrels pull in Node-only modules that break
 * the browser bundle). Those files ship as plain JavaScript with no
 * individual .d.ts, so without these declarations tsc reports TS7016.
 *
 * NOTE: this file must stay a plain ambient script (no top-level
 * import/export). With a top-level import it becomes a module file,
 * and `declare module` blocks inside a module file are treated as
 * augmentations — which do NOT apply to these untyped JS files, so
 * TS7016 comes back. The Stemmer shape below is a minimal structural
 * mirror of the interface in
 * node_modules/natural/lib/natural/stemmers/index.d.ts.
 *
 * Each declaration mirrors the corresponding barrel .d.ts in
 * node_modules/natural/lib/natural/<submodule>/index.d.ts, narrowed to
 * exactly what this codebase uses. `@types/natural` was NOT installed:
 * it only declares the 'natural' root module, not these deep paths,
 * so it would not have fixed the errors.
 */

interface NaturalStemmer {
  stem(token: string): string;
  tokenizeAndStem(text: string, keepStops?: boolean): string[];
}

declare module 'afinn-165' {
  export const afinn165: Record<string, number>;
}

declare module 'natural/lib/natural/stemmers/porter_stemmer' {
  const PorterStemmer: NaturalStemmer;
  export default PorterStemmer;
}

declare module 'natural/lib/natural/tokenizers/regexp_tokenizer' {
  export class WordTokenizer {
    tokenize(text: string): string[];
  }
}

declare module 'natural/lib/natural/ngrams/ngrams' {
  export function ngrams(
    sequence: string | string[],
    n: number,
    startSymbol?: string | null,
    endSymbol?: string,
    stats?: boolean
  ): string[][];
}
