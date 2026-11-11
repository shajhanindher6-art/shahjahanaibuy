/**
 * FAQ content — the single source of truth for the site's FAQs.
 * Rendered by the Help Center (./page.tsx) and the standalone FAQ
 * page (../faq/page.tsx), which imports this list rather than
 * keeping a second copy. No answers are invented here: these are
 * the questions and answers that already lived on /help.
 */
export const FAQS = [

  {
    question: 'How do price alerts work?',
    answer:
      'Create a price alert on a product page with your target price. When the price drops to that level, you are notified through your chosen notification channels. Prices are refreshed every six hours, so an alert can take up to six hours to notice a change. Setting an alert needs a SmartBuy account — sign in first.',
  },
  {
    question: 'How do I cancel Premium?',
    answer:
      'Go to Dashboard > Billing and open the customer portal, where you can manage or cancel your subscription.',
  },
  {
    question: 'Why do I need an account?',
    answer:
      'An account saves your wishlists, alerts, preferences, and recommendations so they are available whenever you sign in.',
  },
  {
    question: 'I found a problem with a price or product. What should I do?',
    answer:
      'Contact us through the contact page and include the product name and the store link so we can check it.',
  },
  {
    question: 'How do SmartBuy coupons work?',
    answer:
      'SmartBuy lists exactly two coupons today — SAVE10 (10% off at Amazon) and BESTBUY15 ($15 off at Best Buy), both valid until January 29, 2027. The discount is applied at the retailer\u2019s checkout, not on SmartBuy: note the code, follow the link, and enter it yourself when you check out there.',
  },
  {
    question: 'What is the Deal Score, and why does it differ from the homepage widget?',
    answer:
      'The Deal Score (0–100) is computed from a product\u2019s recorded price history. Discount percentages on product pages use the merchant compare-at price as their basis; the homepage deals widget uses the deals table, so the two can differ for the same product. The full explanation is on the methodology page.',
  },
  {
    question: 'Are the prices on SmartBuy live retailer prices?',
    answer:
      'No. Prices shown are the site\u2019s recorded catalog figures, refreshed every six hours, and the retailer sets the final price on its own page. Always check the retailer\u2019s page before you buy. Local stores are shown as directory entries with a link only — SmartBuy never invents a local price.',
  },
  {
    question: 'Why does a product say "No reviews yet"?',
    answer:
      'Because SmartBuy has no real reviews today — zero — and the site says so instead of inventing any. Reviews will only ever come from real people, and a review is only shown as verified when the purchase behind it has been confirmed.',
  },
];
