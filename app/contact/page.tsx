import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Contact Us — SmartBuy AI',
  description:
    'Contact SmartBuy AI: send a message by email about the site, Premium, or a business plan.',
  alternates: {
    canonical: `${appConfig.url}/contact`,
  },
};

/**
 * Contact page (Section 10, chunk 2). The form lives in the
 * co-located client component ./contact-form.tsx so this page can
 * stay a Server Component and carry metadata.
 *
 * Honest-response note: this page has no backend — submitting the
 * form only opens the visitor's own email app addressed to
 * support@smartbuy.ai. There is no ticket system and no response
 * time to promise, and whether that mailbox is monitored has not
 * been verified — so the page says so instead of promising a reply
 * within a number of days.
 */
export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <LocalizedHeading dictKey="pageHeadingContact" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            Questions about SmartBuy AI, Premium, or a business plan? Send us a message by
            email.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Please note: this form has no backend — it opens your own email app with a
            message addressed to{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>
            . Your message is only sent if you send that email yourself. We cannot promise
            a response time, and we have not verified that this mailbox is monitored — if
            you need an answer, the{' '}
            <a href="/help" className="underline">
              Help Center
            </a>{' '}
            and the{' '}
            <a href="/faq" className="underline">
              FAQ page
            </a>{' '}
            answer the common questions right away.
          </p>
          <ContactForm />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
