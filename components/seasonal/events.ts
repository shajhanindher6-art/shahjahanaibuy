/**
 * Seasonal event landing pages (Section 3, item 6).
 *
 * Content rule: only RECORDED deals appear here — the six demo launch
 * deals from the site's own deals table. No event prices are invented,
 * and no event-specific discount is claimed. Event dates are calendar
 * facts; the Eid date is an expected date, labelled as such.
 */

export interface SeasonalEvent {
  slug: string;
  name: string;
  /** ISO date the event starts (UTC midnight). */
  startsAt: string;
  /** True when the date is an astronomical expectation, not a confirmed date. */
  dateExpected?: boolean;
  tagline: string;
  description: string;
  tips: string[];
}

export const SEASONAL_EVENTS: SeasonalEvent[] = [
  {
    slug: 'black-friday',
    name: 'Black Friday 2026',
    startsAt: '2026-11-27T00:00:00Z',
    tagline: 'The biggest shopping day of the year — watch the price, not the badge.',
    description:
      'Black Friday falls on Friday, November 27, 2026. It is the day the most "sale" badges appear — and the day a price history matters most, because a discount measured against a price that was quietly raised the week before is not a discount at all. Use the countdown below, check each product\'s history before you buy, and set a price-drop alert at the price you would actually pay instead of trusting the badge.',
    tips: [
      'Open the price history before you trust any "50% off" badge — a genuine sale falls and stays down.',
      'Set a price-drop alert at your real target price now, so the alert — not the badge — decides for you.',
      'Compare the same product at a second retailer on SmartBuy before you buy.',
      'Check the coupon on the product page: SAVE10 and BESTBUY15 are valid until January 29, 2027.',
    ],
  },
  {
    slug: '11-11',
    name: '11.11 Singles\' Day Sale',
    startsAt: '2026-11-11T00:00:00Z',
    tagline: 'The world\'s biggest single-day sale — one day, no second chance.',
    description:
      '11.11 falls on Wednesday, November 11, 2026. It is a one-day event, which makes it the worst day to shop unprepared: prices move fast, stock runs out, and the pressure to buy now is the point. Prepare the day before — pick the product, read its history, set your alert — so that on the day itself you only have to decide yes or no at a price you chose in advance.',
    tips: [
      'Decide your target price the day before, from the product\'s lowest recorded price — not from a round number.',
      'A one-day sale rewards preparation, not speed: have the product page open and the alert already set.',
      'Check the landed cost before ordering across a border — duty, tax, and shipping are added on top of the sale price.',
      'If the price never reaches your target, walk away: a missed sale costs nothing, a rushed purchase does.',
    ],
  },
  {
    slug: 'cyber-monday',
    name: 'Cyber Monday 2026',
    startsAt: '2026-11-30T00:00:00Z',
    tagline: 'The online-only follow-up to Black Friday — the biggest online shopping day of the year.',
    description:
      'Cyber Monday falls on Monday, November 30, 2026 — the Monday after Black Friday (Friday, November 27) and the last day of the five-day Cyber Week that starts with US Thanksgiving on Thursday, November 26. It is the online-first day: the deepest cuts are on laptops, software, and gaming downloads rather than in-store stock. The same rules apply as Black Friday — check the price history before you trust a badge, and set a price-drop alert at the price you would actually pay.',
    tips: [
      'Cyber Monday is online-only by tradition: compare the same product at a second retailer on SmartBuy before you buy.',
      'Set a price-drop alert at your real target price before the day — a one-day event rewards preparation, not speed.',
      'Check the coupon on the product page: SAVE10 and BESTBUY15 are valid until January 29, 2027.',
      'Open the price history first — a "discount" measured against a price that was quietly raised the week before is not a discount.',
    ],
  },
  {
    slug: 'eid',
    name: 'Eid Sale',
    startsAt: '2027-03-09T00:00:00Z',
    dateExpected: true,
    tagline: 'Eid shopping, planned early — gifts and home essentials without the last-minute rush.',
    description:
      'Eid al-Fitr is expected around Tuesday, March 9, 2027 — the exact day is confirmed by moon sighting, so treat this date as expected, not fixed (where Ramadan runs a full 30 days, Eid moves to Wednesday, March 10). Eid is the season for gifts, new clothes, and home essentials, and the same rules apply as any sale: decide the budget first, check the price history, and set an alert at the price you would actually pay.',
    tips: [
      'Set your gift budget as a hard filter: SmartBuy\'s gift finder never recommends above the budget you set.',
      'Buy the essentials early — the last week before Eid is when prices and delivery times both rise.',
      'Keep receipts for gifts: SmartBuy\'s receipt vault records purchase plus warranty months.',
      'Check the return window before buying a gift — an unreturnable gift is a risk, not a bargain.',
    ],
  },
  {
    slug: 'eid-al-adha',
    name: 'Eid al-Adha Sale',
    startsAt: '2027-05-16T00:00:00Z',
    dateExpected: true,
    tagline: 'Eid al-Adha shopping, planned early — gifts, home essentials, and travel needs without the last-minute rush.',
    description:
      'Eid al-Adha is expected around Sunday, May 16, 2027 (10 Dhu al-Hijjah 1448, the day after the Day of Arafah on May 15) — the exact day is confirmed by moon sighting, so treat this date as expected, not fixed. In Pakistan and some other countries that follow a local sighting, Eid may fall on Monday, May 17 instead. The shopping rules are the same as any sale: decide the budget first, check the price history, and set an alert at the price you would actually pay.',
    tips: [
      'Set your gift budget as a hard filter: SmartBuy\'s gift finder never recommends above the budget you set.',
      'Buy the essentials early — the last week before Eid is when prices and delivery times both rise.',
      'Keep receipts for gifts: SmartBuy\'s receipt vault records purchase plus warranty months.',
      'Check the return window before buying a gift — an unreturnable gift is a risk, not a bargain.',
    ],
  },
];

/** The six demo launch deals recorded in SmartBuy's own deals table. */
export interface RecordedDeal {
  productSlug: string;
  productName: string;
  title: string;
  dealType: string;
  discountValue: number;
}

export const RECORDED_DEALS: RecordedDeal[] = [
  { productSlug: 'macbook-air-13', productName: 'MacBook Air 13', title: 'MacBook Air 13 — 10% off', dealType: 'seasonal', discountValue: 10 },
  { productSlug: 'dell-xps-13', productName: 'Dell XPS 13', title: 'Dell XPS 13 — 15% off', dealType: 'seasonal', discountValue: 15 },
  { productSlug: 'sony-wh-1000xm5', productName: 'Sony WH-1000XM5', title: 'Sony WH-1000XM5 — 20% off', dealType: 'flash', discountValue: 20 },
  { productSlug: 'galaxy-s24-ultra', productName: 'Galaxy S24 Ultra', title: 'Galaxy S24 Ultra — 12% off', dealType: 'seasonal', discountValue: 12 },
  { productSlug: 'canon-eos-r10', productName: 'Canon EOS R10', title: 'Canon EOS R10 — 10% off', dealType: 'seasonal', discountValue: 10 },
  { productSlug: 'bose-quietcomfort-ultra', productName: 'Bose QuietComfort Ultra', title: 'Bose QuietComfort Ultra — 15% off', dealType: 'flash', discountValue: 15 },
];

export function getEventBySlug(slug: string): SeasonalEvent | undefined {
  return SEASONAL_EVENTS.find((event) => event.slug === slug);
}
