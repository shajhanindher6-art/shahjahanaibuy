import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';

const faqs = [
  {
    question: 'How do price alerts work?',
    answer:
      'Create a price alert on a product page with your target price. When the price drops to that level, you are notified through your chosen notification channels.',
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
];

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Support</h1>
          <p className="mt-2 text-muted-foreground">
            Answers to common questions. Still stuck?{' '}
            <Link href="/contact" className="underline">
              Contact us
            </Link>{' '}
            or email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>
            .
          </p>
          <div className="mt-8 space-y-4">
            {faqs.map((faq) => (
              <Card key={faq.question}>
                <CardHeader>
                  <CardTitle className="text-base">{faq.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
