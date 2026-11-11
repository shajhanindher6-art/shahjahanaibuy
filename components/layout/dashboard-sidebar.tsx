'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  User,
  Bell,
  LogOut,
  Sparkles,
  Search,
  GitCompare,
  Tag,
  Brain,
  Heart,
  TrendingDown,
  Shield,
  CreditCard,
  KeyRound,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/notifications';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'AI Search', icon: Search },
  { href: '/dashboard/chat', label: 'AI Assistant', icon: Sparkles },
  { href: '/compare', label: 'Compare', icon: GitCompare },
  { href: '/deals', label: 'Smart Deals', icon: Tag },
  { href: '/dashboard/recommendations', label: 'Recommendations', icon: Brain },
  { href: '/dashboard/wishlists', label: 'Wishlists', icon: Heart },
  { href: '/dashboard/tracking', label: 'My Tracking', icon: TrendingDown },
  // Section 13, Chunk F, item 49 — the digest had no sidebar link;
  // it was reachable only by direct URL.
  { href: '/tools/price-drop-digest', label: 'Digest', icon: Mail },
  // Section 13, Chunk G, item 61 — agent hunts lived only as a
  // card on the dashboard, with no sidebar link and no standalone
  // page. The card is on /dashboard; the link lands there (anchor
  // #agent-hunts for the card section).
  { href: '/dashboard#agent-hunts', label: 'Agent Hunts', icon: Sparkles },
];

const accountNavItems: NavItem[] = [
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/dashboard/profile', label: 'Profile', icon: User },
  { href: '/dashboard/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function DashboardSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, profile, role } = useAuth();

  const isAdmin = role === 'admin';

  // Section 14, Chunk 1 — unread notifications badge on the
  // Notifications nav item. One cheap read (limit=1; the count
  // rides in meta.unreadCount) on mount and whenever the
  // notifications page reports a read-state change. A failed or
  // unauthenticated fetch simply hides the badge — never an error
  // state in the nav.
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function loadUnread() {
      try {
        const res = await fetch('/api/v1/notifications?limit=1');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.meta?.unreadCount === 'number') {
          setUnreadNotifications(data.meta.unreadCount);
        }
      } catch {
        // Badge stays hidden; the notifications page still works.
      }
    }
    loadUnread();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnread);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnread);
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Sparkles className="h-5 w-5 text-primary" />
          <span>SmartBuy AI</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-4">
        <div className="space-y-1">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Main</p>
          {mainNavItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="space-y-1">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Account</p>
          {accountNavItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.href === '/dashboard/notifications' && unreadNotifications > 0 && (
                  <span
                    aria-label={`${unreadNotifications} unread notifications`}
                    className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {isAdmin && (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Admin</p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Shield className="h-4 w-4" />
              Admin Panel
            </Link>
          </div>
        )}
      </nav>

      <div className="border-t p-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {profile?.fullName?.[0]?.toUpperCase() ?? profile?.email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium">{profile?.fullName ?? 'User'}</p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
