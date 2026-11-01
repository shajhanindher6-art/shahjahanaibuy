/**
 * Currency Normalizer + budget-expression parser.
 *
 * The bug this fixes: the old budget regex in services/ai-search.ts
 * captured only the digits of a budget ("under 20K PKR" -> 20, and
 * "under 20000 pkr" -> 20000) and treated the number as USD no
 * matter what currency the user wrote. A 20,000 PKR budget (~$71)
 * was therefore filtered/displayed as $20,000, and $500+ phones
 * showed up for a ~$70 budget.
 *
 * This module is deliberately dependency-free (pure functions) so
 * it can be unit-tested in isolation and reused by ai-search and
 * chat without pulling in Supabase or logging.
 *
 * Interpretation rules (these are the rules an LLM "system prompt"
 * would have carried — SmartBuy has no LLM prompt in code; its
 * search "AI" is this deterministic parser in ai-search.ts, so the
 * rules live here and are enforced by code, not by prompt text):
 *   - "K" notation: 20K = 20,000. Also M = 1,000,000, thousand,
 *     million, lakh/lac = 100,000, crore = 10,000,000.
 *   - Currency is auto-detected from a code (PKR, INR, EUR, GBP,
 *     AED, USD, SAR, CAD, AUD, CNY, JPY, BDT), a symbol ($, €, £,
 *     ₹, ₨, ¥), or a word (rupees, dollars, euros, pounds,
 *     dirhams, riyals). "Rs" / "rupees" default to PKR, the
 *     primary market for this app; "₹" is always INR.
 *   - An explicit currency code after the amount wins over a
 *     symbol before it ("$1000 PKR" is read as 1000 PKR).
 *   - A bare number with no currency at all stays USD, matching
 *     the old behaviour for queries like "under $1000" / "under
 *     1000". Only a currency signal changes the unit.
 *
 * Exchange rates are APPROXIMATE static rates (reviewed 2026-11-01),
 * not a live FX feed — no FX API key or dependency is introduced.
 * Converted budgets are therefore shown with "≈" in the UI, and
 * the USD figure is rounded to whole dollars. If a rate drifts
 * enough to matter, update USD_PER_UNIT here; every consumer
 * (catalog search, chat, SerpAPI filter, UI badge) follows.
 */

export type CurrencyCode =
  | 'USD'
  | 'PKR'
  | 'INR'
  | 'EUR'
  | 'GBP'
  | 'AED'
  | 'SAR'
  | 'CAD'
  | 'AUD'
  | 'CNY'
  | 'JPY'
  | 'BDT';

/** Approximate USD value of 1 unit of each supported currency. */
export const USD_PER_UNIT: Record<CurrencyCode, number> = {
  USD: 1,
  // ~280 PKR per USD
  PKR: 1 / 280,
  // ~88 INR per USD
  INR: 1 / 88,
  // ~1 EUR = $1.08
  EUR: 1.08,
  // ~1 GBP = $1.27
  GBP: 1.27,
  // ~3.67 AED per USD
  AED: 1 / 3.67,
  // ~3.75 SAR per USD
  SAR: 1 / 3.75,
  // ~1 CAD = $0.72
  CAD: 0.72,
  // ~1 AUD = $0.65
  AUD: 0.65,
  // ~1 CNY = $0.14
  CNY: 0.14,
  // ~150 JPY per USD
  JPY: 1 / 150,
  // ~122 BDT per USD
  BDT: 1 / 122,
};

const CODE_MAP: Record<string, CurrencyCode> = {
  usd: 'USD',
  pkr: 'PKR',
  inr: 'INR',
  eur: 'EUR',
  gbp: 'GBP',
  aed: 'AED',
  sar: 'SAR',
  cad: 'CAD',
  aud: 'AUD',
  cny: 'CNY',
  jpy: 'JPY',
  bdt: 'BDT',
  'rs': 'PKR',
  'rs.': 'PKR',
  rupees: 'PKR',
  rupee: 'PKR',
  dollars: 'USD',
  dollar: 'USD',
  euros: 'EUR',
  euro: 'EUR',
  pounds: 'GBP',
  pound: 'GBP',
  sterling: 'GBP',
  dirhams: 'AED',
  dirham: 'AED',
  riyals: 'SAR',
  riyal: 'SAR',
};

const SYMBOL_MAP: Record<string, CurrencyCode> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '₨': 'PKR',
  '¥': 'JPY',
};

const MULTIPLIER_MAP: Record<string, number> = {
  k: 1000,
  m: 1000000,
  thousand: 1000,
  million: 1000000,
  lakh: 100000,
  lac: 100000,
  crore: 10000000,
};

function currencyFromToken(token: string | undefined | null): CurrencyCode | null {
  if (!token) return null;
  return CODE_MAP[token.toLowerCase()] ?? SYMBOL_MAP[token] ?? null;
}

/**
 * Detect the first currency signal anywhere in the text (symbol,
 * code or word, by position), or null when there is none.
 */
export function detectCurrencyCode(text: string): CurrencyCode | null {
  const lower = text.toLowerCase();
  let best: { index: number; code: CurrencyCode } | null = null;

  for (const [symbol, code] of Object.entries(SYMBOL_MAP)) {
    const index = text.indexOf(symbol);
    if (index >= 0 && (best === null || index < best.index)) {
      best = { index, code };
    }
  }

  const wordPattern =
    /\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(lower)) !== null) {
    const code = currencyFromToken(match[1]);
    if (code && (best === null || match.index < best.index)) {
      best = { index: match.index, code };
    }
  }

  return best?.code ?? null;
}

/** Convert an amount in `currency` to whole USD (rounded). */
export function normalizeAmountToUsd(amount: number, currency: CurrencyCode): number {
  return Math.round(amount * USD_PER_UNIT[currency]);
}

export interface ParsedBudget {
  /** Normalized budget in USD — the value every USD comparison uses. */
  budgetUsd: number;
  /** Amount exactly as the user wrote it, before conversion. */
  budgetOriginal: number;
  /** Currency the user wrote (or USD when none was given). */
  budgetCurrency: CurrencyCode;
}

const AMOUNT = String.raw`(\d[\d,]*\.?\d*)`;
const MULTIPLIER = String.raw`([kKmM]|lakh|lac|crore|thousand|million)?`;
const CURRENCY_WORD =
  String.raw`(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?)?`;
const KEYWORD =
  String.raw`(?:under|below|less\s+than|up\s+to|upto|max(?:imum)?|budget(?:\s+of|\s+is)?|within|around|cheaper\s+than)`;

// Groups: 1 = symbol, 2 = amount, 3 = multiplier, 4 = currency word
const KEYWORD_PATTERN = new RegExp(
  `${KEYWORD}\\s*([€£₹₨$¥]?)\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
  'i'
);
// Groups: 1 = currency word, 2 = amount, 3 = multiplier
const CURRENCY_FIRST_PATTERN = new RegExp(
  `\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\\.?|rupees?)\\s+${AMOUNT}\\s*${MULTIPLIER}`,
  'i'
);
// Groups: 1 = symbol, 2 = amount, 3 = multiplier
const SYMBOL_FIRST_PATTERN = new RegExp(`([€£₹₨$¥])\\s*${AMOUNT}\\s*${MULTIPLIER}`, 'i');
// Groups: 1 = amount, 2 = multiplier, 3 = currency word
const AMOUNT_CURRENCY_PATTERN = new RegExp(
  `${AMOUNT}\\s*${MULTIPLIER}\\s*\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?)\\b`,
  'i'
);

function multiplierFor(token: string | undefined | null): number {
  if (!token) return 1;
  return MULTIPLIER_MAP[token.toLowerCase()] ?? 1;
}

function buildParsedBudget(
  amountStr: string,
  multiplierToken: string | undefined | null,
  currencyToken: string | undefined | null,
  symbolToken: string | undefined | null,
  fullQuery: string
): ParsedBudget | null {
  const amount = parseFloat(amountStr.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const original = amount * multiplierFor(multiplierToken);
  // Explicit currency word wins over a leading symbol; otherwise
  // fall back to any currency signal elsewhere in the query
  // (e.g. "under 20K in PKR"), then to USD.
  const currency =
    currencyFromToken(currencyToken) ??
    currencyFromToken(symbolToken) ??
    detectCurrencyCode(fullQuery) ??
    'USD';
  return {
    budgetUsd: normalizeAmountToUsd(original, currency),
    budgetOriginal: original,
    budgetCurrency: currency,
  };
}

/**
 * Parse the first budget expression in a query, or null when the
 * query carries no budget. Examples:
 *   "under 20K PKR"    -> { budgetUsd: 71, budgetOriginal: 20000, budgetCurrency: 'PKR' }
 *   "under 20000 pkr"  -> { budgetUsd: 71, budgetOriginal: 20000, budgetCurrency: 'PKR' }
 *   "under $20K"       -> { budgetUsd: 20000, budgetOriginal: 20000, budgetCurrency: 'USD' }
 *   "phone under €500" -> { budgetUsd: 540, budgetOriginal: 500, budgetCurrency: 'EUR' }
 */
export function parseBudgetFromQuery(query: string): ParsedBudget | null {
  const keywordMatch = KEYWORD_PATTERN.exec(query);
  if (keywordMatch) {
    const parsed = buildParsedBudget(
      keywordMatch[2],
      keywordMatch[3],
      keywordMatch[4],
      keywordMatch[1],
      query
    );
    if (parsed) return parsed;
  }

  const currencyFirstMatch = CURRENCY_FIRST_PATTERN.exec(query);
  if (currencyFirstMatch) {
    const parsed = buildParsedBudget(
      currencyFirstMatch[2],
      currencyFirstMatch[3],
      currencyFirstMatch[1],
      null,
      query
    );
    if (parsed) return parsed;
  }

  const symbolFirstMatch = SYMBOL_FIRST_PATTERN.exec(query);
  if (symbolFirstMatch) {
    const parsed = buildParsedBudget(
      symbolFirstMatch[2],
      symbolFirstMatch[3],
      null,
      symbolFirstMatch[1],
      query
    );
    if (parsed) return parsed;
  }

  const amountCurrencyMatch = AMOUNT_CURRENCY_PATTERN.exec(query);
  if (amountCurrencyMatch) {
    const parsed = buildParsedBudget(
      amountCurrencyMatch[1],
      amountCurrencyMatch[2],
      amountCurrencyMatch[3],
      null,
      query
    );
    if (parsed) return parsed;
  }

  return null;
}

const CURRENCY_CODE_ALTERNATION =
  String.raw`pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?`;

/**
 * Remove budget expressions from a query so the remaining text can
 * be used as product search terms. Without this, "under 20K PKR"
 * would leave "K PKR" in the search terms and pollute the ilike
 * match (the old code stripped only "under 20", for exactly this
 * reason the budget words leaked into product matching).
 */
export function stripBudgetFromQuery(query: string): string {
  let cleaned = query;
  const globalPatterns = [
    new RegExp(
      `${KEYWORD}\\s*[€£₹₨$¥]?\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
      'gi'
    ),
    new RegExp(`\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|rs\\.?|rupees?)\\s+${AMOUNT}\\s*${MULTIPLIER}`, 'gi'),
    new RegExp(`[€£₹₨$¥]\\s*${AMOUNT}\\s*${MULTIPLIER}`, 'gi'),
    new RegExp(`${AMOUNT}\\s*${MULTIPLIER}\\s*\\b(${CURRENCY_CODE_ALTERNATION})\\b`, 'gi'),
    // "under 20K in PKR": the keyword pattern stops at "20K", so the
    // trailing "in PKR" must go too, or it leaks into search terms.
    new RegExp(`\\bin\\s+(${CURRENCY_CODE_ALTERNATION})\\b`, 'gi'),
  ];
  for (const pattern of globalPatterns) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/** Format an original-currency amount with grouping, e.g. 20000 -> "20,000". */
export function formatOriginalAmount(amount: number): string {
  return Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
