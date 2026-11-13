'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, Package, Bell, BarChart3,
  Settings, FileText, Flag, Activity, ChevronRight, MousePointerClick, Upload
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth';
import { cn } from '@/lib/utils';

interface Analytics {
  totalUsers: number;
  totalProducts: number;
  totalAlerts: number;
  activeDeals: number;
  totalWishlists: number;
  totalSearches: number;
  topSearched: Array<{ query: string; count: number }>;
  topProducts: Array<{ name: string; views: number }>;
  recentSignups: number;
}

interface AuditLog {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
}

interface AffiliateClicks {
  days: number;
  totalClicks: number;
  flaggedClicks: number;
  clicksToday: number;
  topCountry: string | null;
  topRetailer: string | null;
  topProduct: string | null;
  byCountry: Array<{ label: string; clicks: number }>;
  byRetailer: Array<{ label: string; clicks: number }>;
  byProduct: Array<{ label: string; clicks: number }>;
  byDay: Array<{ date: string; clicks: number }>;
  recent: Array<{
    productSlug: string | null;
    retailerName: string | null;
    targetUrl: string;
    countryCode: string | null;
    clickedAt: string;
  }>;
  flags: Array<{
    hour: string;
    countryCode: string | null;
    retailerName: string | null;
    productSlug: string | null;
    clicks: number;
  }>;
}

export default function AdminPage() {
  const { profile, role } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  // Final 100%, F-P2-54 — audit-log viewer: filter/search state +
  // an honest error state. The viewer used to swallow a failed
  // fetch into an empty list (and had no filter/search at all);
  // a failure is now shown, never rendered as "no logs yet".
  const [logActionFilter, setLogActionFilter] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [logsError, setLogsError] = useState<string | null>(null);

  const fetchAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const logParams = new URLSearchParams({ limit: '20' });
      if (logActionFilter.trim()) logParams.set('action', logActionFilter.trim());
      if (logSearch.trim()) logParams.set('q', logSearch.trim());
      const [analyticsRes, logsRes] = await Promise.all([
        fetch('/api/v1/admin/analytics'),
        fetch(`/api/v1/admin/audit-logs?${logParams.toString()}`),
      ]);

      const analyticsData = await analyticsRes.json();
      if (analyticsData.success) setAnalytics(analyticsData.data);

      const logsData = await logsRes.json();
      if (logsData.success) {
        setLogs(logsData.data ?? []);
        setLogsError(null);
      } else {
        // Surface the failure honestly: the API returns 503 with
        // the real reason (e.g. the audit-log table is unapplied)
        // instead of a silent empty list.
        setLogs([]);
        setLogsError(
          typeof logsData.error?.message === 'string'
            ? logsData.error.message
            : 'Audit logs could not be loaded.'
        );
      }
    } catch {
      // Admin endpoints require auth — but say so instead of
      // rendering an empty list as if there were no logs.
      setLogsError('Audit logs could not be loaded (request failed).');
    } finally {
      setLoading(false);
    }
  }, [logActionFilter, logSearch]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const isAdmin = role === 'admin';

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <LayoutDashboard className="h-8 w-8 text-blue-600" />
            Admin Panel
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage users, products, analytics, and system configuration
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/intake">
                <Upload className="mr-2 h-4 w-4" /> Catalog intake — CSV upload &amp; review
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/intake/ebay">
                <Package className="mr-2 h-4 w-4" /> eBay Browse import — live listings &amp; review
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/products">
                <Package className="mr-2 h-4 w-4" /> Products — list, edit &amp; delete
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/products/review">
                <Package className="mr-2 h-4 w-4" /> Catalog review — duplicates, specs, images, history
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/ingestion-failures">
                <Activity className="mr-2 h-4 w-4" /> Ingestion failures — error log &amp; failed runs
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/refresh-runs">
                <Activity className="mr-2 h-4 w-4" /> Price refresh runs — last refresh &amp; failed steps
              </Link>
            </Button>
          </div>
        </div>

        {analytics && (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Total Users" value={analytics.totalUsers} subtext={`${analytics.recentSignups} new this week`} />
            <StatCard icon={Package} label="Products" value={analytics.totalProducts} />
            <StatCard icon={Bell} label="Active Alerts" value={analytics.totalAlerts} />
            <StatCard icon={BarChart3} label="Active Deals" value={analytics.activeDeals} />
            <StatCard icon={FileText} label="Wishlists" value={analytics.totalWishlists} />
            <StatCard icon={Activity} label="Total Searches" value={analytics.totalSearches} />
          </div>
        )}

        <Tabs defaultValue="analytics" className="mt-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="logs">Audit Logs</TabsTrigger>
            <TabsTrigger value="flags">Feature Flags</TabsTrigger>
            <TabsTrigger value="affiliate">Affiliate Clicks</TabsTrigger>
          </TabsList>

          <TabsContent value="analytics" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Searches</CardTitle>
                </CardHeader>
                <CardContent>
                  {analytics?.topSearched && analytics.topSearched.length > 0 ? (
                    <div className="space-y-2">
                      {analytics.topSearched.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="truncate">{s.query}</span>
                          <Badge variant="secondary">{s.count}x</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No search data yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Most Viewed Products</CardTitle>
                </CardHeader>
                <CardContent>
                  {analytics?.topProducts && analytics.topProducts.length > 0 ? (
                    <div className="space-y-2">
                      {analytics.topProducts.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="truncate">{p.name}</span>
                          <Badge variant="secondary">{p.views} views</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No product views yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">User Management</CardTitle>
                <CardDescription>View and manage registered users</CardDescription>
              </CardHeader>
              <CardContent>
                <UsersTable />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Admin Audit Logs</CardTitle>
                <CardDescription>
                  Recent admin actions — filter by action, or search across action / target type / target id.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-2">
                  <Input
                    value={logActionFilter}
                    onChange={(e) => setLogActionFilter(e.target.value)}
                    placeholder="Filter by action (e.g. product_update)"
                    aria-label="Filter audit logs by action"
                    className="max-w-xs"
                  />
                  <Input
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Search action / target"
                    aria-label="Search audit logs"
                    className="max-w-xs"
                  />
                  <Button variant="outline" onClick={() => fetchAdminData()}>
                    Apply filters
                  </Button>
                  {(logActionFilter || logSearch) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLogActionFilter('');
                        setLogSearch('');
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {logsError ? (
                  <p role="alert" className="text-sm text-red-600">
                    {logsError}
                  </p>
                ) : logs.length > 0 ? (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm dark:border-slate-800">
                        <div>
                          <span className="font-medium">{log.action}</span>
                          <span className="ml-2 text-muted-foreground">{log.targetType}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No audit logs yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="flags" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feature Flags</CardTitle>
                <CardDescription>Toggle features on or off</CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureFlagsManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="affiliate" className="mt-4">
            <AffiliateClicksSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Geo-click reporting — Step C. Fetches GET /api/v1/admin/affiliate-clicks
 * (admin-only). Headline totals exclude flagged burst clicks; the
 * exclusion is stated on the page and flagged buckets are listed, not
 * hidden. No per-user data exists anywhere in this surface — recent
 * clicks show product, retailer, country, time, and the merchant host.
 */
function AffiliateClicksSection() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AffiliateClicks | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/admin/affiliate-clicks?days=${days}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setData(json.data ?? null);
      })
      .catch(() => {
        // Error state renders below via data === null.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) return <LoadingSpinner />;

  if (!data) {
    return <p className="text-sm text-muted-foreground">Could not load affiliate clicks.</p>;
  }

  const isEmpty = data.totalClicks === 0 && data.flaggedClicks === 0;
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Outbound merchant-link clicks logged by the geo affiliate beacon.
          Burst-flagged clicks are excluded from the totals below.
        </p>
        <div className="flex gap-1">
          {([7, 30, 90] as const).map((d) => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={MousePointerClick} label="Total clicks" value={data.totalClicks} subtext={`last ${data.days} days, burst-flagged excluded`} />
        <StatCard icon={Activity} label="Clicks today" value={data.clicksToday} />
        <StatCard icon={Flag} label="Top country" value={0} display={data.topCountry ?? '—'} />
        <StatCard icon={Package} label="Top retailer" value={0} display={data.topRetailer ?? '—'} />
      </div>

      {data.flags.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="text-base">Burst flags — {data.flaggedClicks} clicks excluded</CardTitle>
            <CardDescription>
              Buckets over 100 clicks/hour for one country + retailer + product.
              These clicks are not counted in the totals or charts above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {data.flags.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate">
                    {f.hour} · {f.countryCode ?? 'Unknown'} · {f.retailerName ?? 'Unknown retailer'} · {f.productSlug ?? 'Unknown product'}
                  </span>
                  <Badge variant="secondary">{f.clicks} clicks</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isEmpty ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No clicks yet in the selected range.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clicks by country</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byCountry.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="clicks" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clicks by retailer</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byRetailer.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="clicks" fill="#059669" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clicks per day</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.byDay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} interval={Math.max(0, Math.floor(data.byDay.length / 10))} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="clicks" stroke="#2563eb" fill="#93c5fd" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top products</CardTitle>
              </CardHeader>
              <CardContent>
                {data.byProduct.length > 0 ? (
                  <div className="space-y-2">
                    {data.byProduct.map((p) => (
                      <div key={p.label} className="flex items-center justify-between text-sm">
                        <span className="truncate">{p.label}</span>
                        <Badge variant="secondary">{p.clicks}x</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No product clicks yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent clicks</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recent.length > 0 ? (
                  <div className="space-y-2">
                    {data.recent.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0 dark:border-slate-800">
                        <div className="min-w-0">
                          <span className="block truncate font-medium">{c.productSlug ?? 'Unknown product'}</span>
                          <a href={c.targetUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-blue-600 hover:underline">
                            {hostOf(c.targetUrl)}
                          </a>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <span className="block">{c.retailerName ?? '—'} · {c.countryCode ?? '—'}</span>
                          <span className="block">{new Date(c.clickedAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent clicks.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, subtext, display }: { icon: typeof Users; label: string; value: number; subtext?: string; display?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-2xl font-bold">{display ?? value.toLocaleString()}</p>
            {subtext && <p className="mt-0.5 text-xs text-green-600">{subtext}</p>}
          </div>
          <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
            <Icon className="h-5 w-5 text-blue-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UsersTable() {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/admin/users?page=1&pageSize=20')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setUsers(data.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (users.length === 0) return <p className="text-sm text-muted-foreground">No users found.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="p-2 text-left font-medium">Email</th>
            <th className="p-2 text-left font-medium">Name</th>
            <th className="p-2 text-left font-medium">Role</th>
            <th className="p-2 text-left font-medium">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id as string} className="border-b border-slate-100 dark:border-slate-800">
              <td className="p-2">{user.email as string}</td>
              <td className="p-2">{user.full_name as string ?? '—'}</td>
              <td className="p-2"><Badge variant="secondary">{user.role as string ?? 'user'}</Badge></td>
              <td className="p-2 text-muted-foreground">{new Date(user.created_at as string).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeatureFlagsManager() {
  const [flags, setFlags] = useState<Array<{ key: string; enabled: boolean }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/feature-flags')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setFlags(data.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (flags.length === 0) return <p className="text-sm text-muted-foreground">No feature flags configured.</p>;

  return (
    <div className="space-y-2">
      {flags.map((flag) => (
        <div key={flag.key} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div>
            <span className="font-medium">{flag.key}</span>
          </div>
          <Badge variant={flag.enabled ? 'default' : 'secondary'}>
            {flag.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      ))}
    </div>
  );
}
