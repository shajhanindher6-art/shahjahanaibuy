'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, Package, Bell, BarChart3,
  Settings, FileText, Flag, Activity, ChevronRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
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

export default function AdminPage() {
  const { profile, role } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, logsRes] = await Promise.all([
        fetch('/api/v1/admin/analytics'),
        fetch('/api/v1/admin/audit-logs?limit=20'),
      ]);

      const analyticsData = await analyticsRes.json();
      if (analyticsData.success) setAnalytics(analyticsData.data);

      const logsData = await logsRes.json();
      if (logsData.success) setLogs(logsData.data ?? []);
    } catch {
      // Admin endpoints require auth
    } finally {
      setLoading(false);
    }
  }, []);

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
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="logs">Audit Logs</TabsTrigger>
            <TabsTrigger value="flags">Feature Flags</TabsTrigger>
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
                <CardDescription>Recent admin actions</CardDescription>
              </CardHeader>
              <CardContent>
                {logs.length > 0 ? (
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
        </Tabs>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, subtext }: { icon: typeof Users; label: string; value: number; subtext?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
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
