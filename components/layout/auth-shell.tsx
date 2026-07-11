'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl">
              <Sparkles className="h-7 w-7 text-primary" />
              <span>SmartBuy AI</span>
            </Link>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{description}</p>
            {children}
          </div>
          {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
