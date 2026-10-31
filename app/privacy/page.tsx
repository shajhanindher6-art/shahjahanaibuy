import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-muted-foreground">
          <h1 className="text-3xl font-bold text-foreground">Privacy Policy</h1>
          <p>
            SmartBuy AI collects the information needed to run your account and the features
            you use: your account details, wishlists, price alerts, preferences, and usage
            such as products viewed and searches made. This information is used to provide
            recommendations, alerts, and deal tracking, and to keep the service secure.
          </p>
          <p>
            Prices and product information come from retailers and other data sources. We do
            not sell your personal information. Service providers that help run the site,
            such as hosting, database, payment, and email providers, only receive the data
            needed to provide their service.
          </p>
          <p>
            You can update your profile and notification preferences from your dashboard,
            and you can ask for your account to be deleted by contacting support at{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>
            . This is starter policy text and should be reviewed by the site owner before
            launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
