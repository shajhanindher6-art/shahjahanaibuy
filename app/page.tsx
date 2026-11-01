import Link from 'next/link';
import {
  Sparkles,
  Brain,
  TrendingDown,
  Shield,
  Search,
  BarChart3,
  LineChart,
  Globe,
  ArrowRight,
  Check,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { SmartDealWidget } from '@/components/deals/smart-deal-widget';

const features = [
  {
    icon: Brain,
    title: 'AI Recommendations',
    description:
      'Get personalized product recommendations powered by advanced AI that explains every suggestion.',
  },
  {
    icon: TrendingDown,
    title: 'Price Tracking',
    description:
      'Monitor price changes across retailers and get alerted when prices drop on products you care about.',
  },
  {
    icon: Search,
    title: 'Semantic Search',
    description:
      'Search with natural language — describe what you need, and our AI finds the best matches.',
  },
  {
    icon: Shield,
    title: 'Trust Scoring',
    description:
      'Make confident decisions with AI-powered trust scores for products and sellers based on real data.',
  },
  {
    icon: BarChart3,
    title: 'Review Analysis',
    description:
      'AI-summarized reviews that surface the most important insights from thousands of customer opinions.',
  },
  {
    icon: LineChart,
    title: 'Price Prediction',
    description:
      'Know the best time to buy with AI price trend predictions that forecast future price movements.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create Your Account',
    description: 'Sign up in seconds and set your preferences, budget, and shopping goals.',
  },
  {
    number: '02',
    title: 'Get AI Insights',
    description:
      'Our AI analyzes millions of products, reviews, and prices to find the best options for you.',
  },
  {
    number: '03',
    title: 'Shop Smarter',
    description:
      'Make confident decisions with explainable recommendations and real-time price alerts.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for getting started with smarter shopping.',
    features: ['Basic search', 'Up to 5 price alerts', 'Community support'],
    cta: 'Get Started',
    href: '/sign-up',
    highlighted: false,
  },
  {
    name: 'Premium',
    price: '$9.99',
    period: 'per month',
    description: 'Unlock the full power of AI-driven shopping intelligence.',
    features: [
      'Unlimited price alerts',
      'AI recommendations',
      'Review analysis',
      'Price prediction',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    href: '/sign-up',
    highlighted: true,
  },
  {
    name: 'Business',
    price: 'Custom',
    period: 'contact us',
    description: 'For teams and businesses that need advanced capabilities.',
    features: ['Everything in Premium', 'API access', 'Team management', 'Dedicated support'],
    cta: 'Contact Sales',
    href: '/contact',
    highlighted: false,
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="container relative mx-auto px-4 py-20 md:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-4 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI-Powered Shopping Intelligence
              </Badge>
              <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
                Make smarter{' '}
                <span className="bg-gradient-to-r from-primary to-chart-4 bg-clip-text text-transparent">
                  shopping decisions
                </span>{' '}
                with AI
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
                SmartBuy AI analyzes millions of products, reviews, and prices in real-time to
                help you find the best deals, avoid bad purchases, and shop with confidence.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link href="/sign-up">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/search">
                    <Search className="mr-2 h-4 w-4" />
                    Try AI Search
                  </Link>
                </Button>
              </div>
              <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" />
                  No credit card required
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" />
                  Free forever plan
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="border-y bg-muted/30">
          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { value: '10M+', label: 'Products Tracked' },
                { value: '500+', label: 'Retailers Monitored' },
                { value: '99.9%', label: 'Uptime Guarantee' },
                { value: '< 200ms', label: 'Response Time' },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-3xl font-bold text-primary md:text-4xl">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Everything you need to shop smarter
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Powerful AI-driven features that help you make the best purchasing decisions,
                every time.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Card
                  key={feature.title}
                  className="group transition-shadow hover:shadow-lg animate-fade-in"
                >
                  <CardHeader>
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      {feature.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Smart Deal Recommendations */}
        <section className="border-t py-20 md:py-28">
          <div className="container mx-auto px-4">
            <SmartDealWidget limit={6} />
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="border-y bg-muted/30 py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                How SmartBuy AI works
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Three simple steps to transform how you shop online.
              </p>
            </div>
            <div className="mt-16 grid gap-8 md:grid-cols-3">
              {steps.map((step) => (
                <div key={step.number} className="relative text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                    {step.number}
                  </div>
                  <h3 className="mb-2 text-xl font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Trusted by smart shoppers
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Join thousands of users who shop smarter with AI.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              {[
                {
                  name: 'Sarah K.',
                  role: 'Verified User',
                  quote:
                    'SmartBuy AI saved me $300 on a laptop by predicting a price drop. The AI recommendations are spot on.',
                },
                {
                  name: 'Michael R.',
                  role: 'Premium Member',
                  quote:
                    'The review analysis feature is a game changer. I can instantly see if a product is worth buying.',
                },
                {
                  name: 'Emily T.',
                  role: 'Daily Shopper',
                  quote:
                    'I love how the AI explains its recommendations. It feels like having a personal shopping advisor.',
                },
              ].map((testimonial) => (
                <Card key={testimonial.name}>
                  <CardContent className="pt-6">
                    <div className="mb-4 flex gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-warning text-warning" />
                      ))}
                    </div>
                    <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{testimonial.quote}&rdquo;
                    </p>
                    <div>
                      <div className="font-semibold">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t bg-muted/30 py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Simple, transparent pricing
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Start free, upgrade when you need more. No hidden fees.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              {plans.map((plan) => (
                <Card
                  key={plan.name}
                  className={
                    plan.highlighted
                      ? 'border-primary shadow-lg ring-1 ring-primary'
                      : ''
                  }
                >
                  <CardHeader>
                    {plan.highlighted && (
                      <Badge className="mb-2 w-fit">Most Popular</Badge>
                    )}
                    <CardTitle className="text-2xl">{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plan.price}</span>
                      <span className="text-sm text-muted-foreground"> / {plan.period}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-success" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-6 w-full"
                      variant={plan.highlighted ? 'default' : 'outline'}
                      asChild
                    >
                      <Link href={plan.href}>{plan.cta}</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="relative overflow-hidden rounded-2xl bg-primary p-12 text-center text-primary-foreground md:p-20">
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-chart-4 opacity-90" />
              <div className="relative">
                <Globe className="mx-auto mb-4 h-12 w-12" />
                <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                  Ready to shop smarter?
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/90">
                  Join thousands of users who are making better purchasing decisions with AI.
                </p>
                <Button size="lg" variant="secondary" className="mt-8" asChild>
                  <Link href="/sign-up">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
