'use client';

import { MobileNav } from './mobile-nav';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/features/auth';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function DashboardHeader() {
  const { profile } = useAuth();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <MobileNav />
        <h1 className="text-lg font-semibold">
          {profile?.fullName ? `Welcome, ${profile.fullName.split(' ')[0]}` : 'Dashboard'}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/notifications">
            <Bell className="h-5 w-5" />
            <span className="sr-only">Notifications</span>
          </Link>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
