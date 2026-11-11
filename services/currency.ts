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
 *     AED, USD, SAR, CAD, AUD, CNY, JPY, BDT, plus the 37
 *     worldwide-expansion codes), a symbol ($, €, £, ₹, ₨, ¥, ₩,
 *     ₺, ₱, ฿, ₫, ₴, ₦), or a word (rupees, dollars, euros, pounds,
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
 *
 * The worldwide-expansion block (2026-11-02) adds the region
 * currencies for 50+ markets on the same approximate basis
 * (reviewed 2026-11-02). Venezuela and Ecuador use USD: both are
 * dollarized in practice, and no reliable VES rate is asserted.
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
  | 'BDT'
  | 'BRL'
  | 'TRY'
  | 'QAR'
  | 'EGP'
  | 'MXN'
  | 'KRW'
  | 'IDR'
  | 'THB'
  | 'VND'
  | 'PHP'
  | 'MYR'
  | 'SGD'
  | 'NGN'
  | 'KES'
  | 'MAD'
  | 'PLN'
  | 'CHF'
  | 'ZAR'
  | 'CLP'
  | 'ARS'
  | 'COP'
  | 'PEN'
  | 'UAH'
  | 'TWD'
  | 'XOF'
  | 'GHS'
  | 'UGX'
  | 'LKR'
  | 'NPR'
  | 'UYU'
  | 'BOB'
  | 'PYG'
  | 'CRC'
  | 'GTQ'
  | 'DOP'
  | 'PAB'
  | 'HNL'
  | 'NIO'
  | 'CZK';

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
  // --- Worldwide expansion (reviewed 2026-11-02): approximate
  // static rates for the new region currencies, same convention
  // (USD value of 1 unit), always shown with "≈" in the UI.
  // ~5.4 BRL per USD
  BRL: 1 / 5.4,
  // ~43 TRY per USD
  TRY: 1 / 43,
  // ~3.64 QAR per USD (pegged)
  QAR: 1 / 3.64,
  // ~48.5 EGP per USD
  EGP: 1 / 48.5,
  // ~17.2 MXN per USD
  MXN: 1 / 17.2,
  // ~1470 KRW per USD
  KRW: 1 / 1470,
  // ~16500 IDR per USD
  IDR: 1 / 16500,
  // ~32.5 THB per USD
  THB: 1 / 32.5,
  // ~26200 VND per USD
  VND: 1 / 26200,
  // ~59 PHP per USD
  PHP: 1 / 59,
  // ~4.2 MYR per USD
  MYR: 1 / 4.2,
  // ~1.29 SGD per USD
  SGD: 1 / 1.29,
  // ~1460 NGN per USD
  NGN: 1 / 1460,
  // ~129 KES per USD
  KES: 1 / 129,
  // ~9.0 MAD per USD
  MAD: 1 / 9.0,
  // ~3.65 PLN per USD
  PLN: 1 / 3.65,
  // ~1 CHF = $1.25
  CHF: 1.25,
  // ~17.3 ZAR per USD
  ZAR: 1 / 17.3,
  // ~940 CLP per USD
  CLP: 1 / 940,
  // ~1450 ARS per USD
  ARS: 1 / 1450,
  // ~3900 COP per USD
  COP: 1 / 3900,
  // ~3.4 PEN per USD
  PEN: 1 / 3.4,
  // ~42 UAH per USD
  UAH: 1 / 42,
  // ~31.5 TWD per USD
  TWD: 1 / 31.5,
  // ~560 XOF per USD (West African CFA franc, euro-pegged)
  XOF: 1 / 560,
  // ~11.5 GHS per USD
  GHS: 1 / 11.5,
  // ~3650 UGX per USD
  UGX: 1 / 3650,
  // ~300 LKR per USD
  LKR: 1 / 300,
  // ~133 NPR per USD
  NPR: 1 / 133,
  // ~40 UYU per USD
  UYU: 1 / 40,
  // ~6.9 BOB per USD
  BOB: 1 / 6.9,
  // ~7500 PYG per USD
  PYG: 1 / 7500,
  // ~500 CRC per USD
  CRC: 1 / 500,
  // ~7.7 GTQ per USD
  GTQ: 1 / 7.7,
  // ~63 DOP per USD
  DOP: 1 / 63,
  // Panama is dollarized: 1 PAB = $1
  PAB: 1,
  // ~26 HNL per USD
  HNL: 1 / 26,
  // ~36.5 NIO per USD
  NIO: 1 / 36.5,
  // ~21 CZK per USD
  CZK: 1 / 21,
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
  brl: 'BRL',
  try: 'TRY',
  qar: 'QAR',
  egp: 'EGP',
  mxn: 'MXN',
  krw: 'KRW',
  idr: 'IDR',
  thb: 'THB',
  vnd: 'VND',
  php: 'PHP',
  myr: 'MYR',
  sgd: 'SGD',
  ngn: 'NGN',
  kes: 'KES',
  mad: 'MAD',
  pln: 'PLN',
  chf: 'CHF',
  zar: 'ZAR',
  clp: 'CLP',
  ars: 'ARS',
  cop: 'COP',
  pen: 'PEN',
  uah: 'UAH',
  twd: 'TWD',
  xof: 'XOF',
  ghs: 'GHS',
  ugx: 'UGX',
  lkr: 'LKR',
  npr: 'NPR',
  uyu: 'UYU',
  bob: 'BOB',
  pyg: 'PYG',
  crc: 'CRC',
  gtq: 'GTQ',
  dop: 'DOP',
  pab: 'PAB',
  hnl: 'HNL',
  nio: 'NIO',
  czk: 'CZK',
  real: 'BRL',
  reais: 'BRL',
  lira: 'TRY',
  liras: 'TRY',
  won: 'KRW',
  baht: 'THB',
  dong: 'VND',
  ringgit: 'MYR',
  rand: 'ZAR',
  zloty: 'PLN',
  naira: 'NGN',
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
  '₩': 'KRW',
  '₺': 'TRY',
  '₱': 'PHP',
  '฿': 'THB',
  '₫': 'VND',
  '₴': 'UAH',
  '₦': 'NGN',
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
    /\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?|real|reais|lira|liras|won|baht|dong|ringgit|rand|zloty|naira)\b/gi;
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

/**
 * A price BAND ("between $500 and $1000", "$500–$1000"), as opposed
 * to the single max budget ParsedBudget carries. Both ends share one
 * currency (the band's currency); USD figures are whole dollars
 * converted with the same approximate static rates as
 * parseBudgetFromQuery, so they are shown with "≈" in the UI.
 */
export interface ParsedPriceBand {
  budgetMinUsd: number;
  budgetMaxUsd: number;
  budgetCurrency: CurrencyCode;
  budgetOriginalMin: number;
  budgetOriginalMax: number;
}

const AMOUNT = String.raw`(\d[\d,]*\.?\d*)`;
const MULTIPLIER = String.raw`([kKmM]|lakh|lac|crore|thousand|million)?`;
const CURRENCY_WORD =
  String.raw`(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?|real|reais|lira|liras|won|baht|dong|ringgit|rand|zloty|naira)?`;
const KEYWORD =
  String.raw`(?:under|below|less\s+than|up\s+to|upto|max(?:imum)?|budget(?:\s+of|\s+is)?|within|around|cheaper\s+than)`;

// Groups: 1 = symbol, 2 = amount, 3 = multiplier, 4 = currency word
const KEYWORD_PATTERN = new RegExp(
  `${KEYWORD}\\s*([€£₹₨$¥₩₺₱฿₫₴₦]?)\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
  'i'
);
// Groups: 1 = currency word, 2 = amount, 3 = multiplier
const CURRENCY_FIRST_PATTERN = new RegExp(
  `\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\\.?|rupees?)\\s+${AMOUNT}\\s*${MULTIPLIER}`,
  'i'
);
// Groups: 1 = symbol, 2 = amount, 3 = multiplier
const SYMBOL_FIRST_PATTERN = new RegExp(`([€£₹₨$¥₩₺₱฿₫₴₦])\\s*${AMOUNT}\\s*${MULTIPLIER}`, 'i');
// Groups: 1 = amount, 2 = multiplier, 3 = currency word
const AMOUNT_CURRENCY_PATTERN = new RegExp(
  `${AMOUNT}\\s*${MULTIPLIER}\\s*\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?|real|reais|lira|liras|won|baht|dong|ringgit|rand|zloty|naira)\\b`,
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
 *
 * NOTE: a price BAND ("between $500 and $1000") is NOT parsed here —
 * parsePriceBandFromQuery owns it, and callers must check the band
 * first: the symbol-first pattern below would otherwise read the
 * band's lower end as the whole (max) budget.
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

// ---------------------------------------------------------------------------
// Price bands ("between $500 and $1000", "$500–$1000")
// ---------------------------------------------------------------------------

// Groups: 1 = symbol, 2 = amount, 3 = multiplier, 4 = symbol,
// 5 = amount, 6 = multiplier, 7 = currency word
const BETWEEN_BAND_PATTERN = new RegExp(
  `\\bbetween\\s*([€£₹₨$¥₩₺₱฿₫₴₦]?)\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*(?:and|-|–|—|to)\\s*([€£₹₨$¥₩₺₱฿₫₴₦]?)\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
  'i'
);
// A bare "500-1000" with no symbol and no "between" is NOT a band
// (it could be a model number) — the dash form requires at least
// one currency symbol. Groups: 1 = symbol, 2 = amount,
// 3 = multiplier, 4 = symbol, 5 = amount, 6 = multiplier,
// 7 = currency word
const DASH_BAND_PATTERN = new RegExp(
  `([€£₹₨$¥₩₺₱฿₫₴₦])\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*[-–—]\\s*([€£₹₨$¥₩₺₱฿₫₴₦]?)\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
  'i'
);

function bandEndpoint(
  amountStr: string,
  multiplierToken: string | undefined | null
): { original: number } | null {
  const amount = parseFloat(amountStr.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { original: amount * multiplierFor(multiplierToken) };
}

/**
 * Parse the first price-band expression in a query, or null when
 * there is none. Examples:
 *   "between $500 and $1000" -> { budgetMinUsd: 500, budgetMaxUsd: 1000, ... }
 *   "laptop $500–$1000"      -> same (en dash, dollar signs)
 *   "between 20K and 50K PKR" -> { budgetMinUsd: 71, budgetMaxUsd: 179, budgetCurrency: 'PKR', ... }
 * Reversed ends ("between $1000 and $500") are normalized to
 * min/max rather than rejected — the visitor's intent is the range.
 */
export function parsePriceBandFromQuery(query: string): ParsedPriceBand | null {
  const match = BETWEEN_BAND_PATTERN.exec(query) ?? DASH_BAND_PATTERN.exec(query);
  if (!match) return null;
  const low = bandEndpoint(match[2], match[3]);
  const high = bandEndpoint(match[5], match[6]);
  if (!low || !high) return null;
  // One currency for the whole band: an explicit currency word
  // wins, then either endpoint's symbol, then any currency signal
  // elsewhere in the query, then USD.
  const currency =
    currencyFromToken(match[7]) ??
    currencyFromToken(match[1]) ??
    currencyFromToken(match[4]) ??
    detectCurrencyCode(query) ??
    'USD';
  const minOriginal = Math.min(low.original, high.original);
  const maxOriginal = Math.max(low.original, high.original);
  const minUsd = normalizeAmountToUsd(minOriginal, currency);
  const maxUsd = normalizeAmountToUsd(maxOriginal, currency);
  if (minUsd <= 0 || maxUsd <= 0 || minUsd >= maxUsd) return null;
  return {
    budgetMinUsd: minUsd,
    budgetMaxUsd: maxUsd,
    budgetCurrency: currency,
    budgetOriginalMin: minOriginal,
    budgetOriginalMax: maxOriginal,
  };
}

const CURRENCY_CODE_ALTERNATION =
  String.raw`pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\.?|rupees?|dollars?|euros?|pounds?|sterling|dirhams?|riyals?|real|reais|lira|liras|won|baht|dong|ringgit|rand|zloty|naira`;

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
    // Price bands first: "between $500 and $1000" / "$500–$1000"
    // — otherwise the keyword/symbol patterns below would strip
    // only the lower end and leave "$1000" in the search terms.
    new RegExp(
      `\\bbetween\\s*[€£₹₨$¥₩₺₱฿₫₴₦]?\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*(?:and|-|–|—|to)\\s*[€£₹₨$¥₩₺₱฿₫₴₦]?\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
      'gi'
    ),
    new RegExp(
      `[€£₹₨$¥₩₺₱฿₫₴₦]\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*[-–—]\\s*[€£₹₨$¥₩₺₱฿₫₴₦]?\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
      'gi'
    ),
    new RegExp(
      `${KEYWORD}\\s*[€£₹₨$¥₩₺₱฿₫₴₦]?\\s*${AMOUNT}\\s*${MULTIPLIER}\\s*${CURRENCY_WORD}`,
      'gi'
    ),
    new RegExp(`\\b(pkr|inr|eur|gbp|aed|usd|sar|cad|aud|cny|jpy|bdt|brl|try|qar|egp|mxn|krw|idr|thb|vnd|php|myr|sgd|ngn|kes|mad|pln|chf|zar|clp|ars|cop|pen|uah|twd|xof|ghs|ugx|lkr|npr|uyu|bob|pyg|crc|gtq|dop|pab|hnl|nio|czk|rs\\.?|rupees?)\\s+${AMOUNT}\\s*${MULTIPLIER}`, 'gi'),
    new RegExp(`[€£₹₨$¥₩₺₱฿₫₴₦]\\s*${AMOUNT}\\s*${MULTIPLIER}`, 'gi'),
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
