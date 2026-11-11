'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Mail, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';

interface NotificationEntry {
  id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  /** Read flag (Section 13, item 58) — stored in the row's jsonb
      `data` column by PATCH /api/v1/notifications/[id]; the
      delivery `status` is untouched. */
  data?: { read?: boolean } | null;
}

/** True when the user has marked the row read (data.read flag). */
function isNotificationRead(n: NotificationEntry): boolean {
  return n.data?.read === true;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/notifications?limit=20');
      const data = await res.json();
      if (data.success) {
        setNotifications(data.data ?? []);
      }
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Section 13, item 58 — mark-as-read. PATCH
  // /api/v1/notifications/[id] flips the data.read flag (no
  // migration, delivery status untouched); the list is re-read so
  // the dimmed state always reflects the server.
  const markAsRead = useCallback(async (id: string, read: boolean) => {
    try {
      const res = await fetch(`/api/v1/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read }),
      });
      if (res.ok) fetchNotifications();
    } catch {
      // The row keeps its previous state; retry from the button.
    }
  }, [fetchNotifications]);

  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !isNotificationRead(n));
    await Promise.all(unread.map((n) => markAsRead(n.id, true)));
  }, [notifications, markAsRead]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {notifications.some((n) => !isNotificationRead(n)) && (
          <Button size="sm" variant="outline" onClick={markAllAsRead}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all as read
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You'll see price alerts, deal notifications, and weekly digests here."
              action={
                <div className="flex flex-col items-center gap-2">
                  <Button size="sm" asChild>
                    <Link href="/search">Find a product to watch</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/tools/price-drop-digest">View your price-drop digest</Link>
                  </Button>
                </div>
              }
            />
            {/* Section 13, items 51 + 52 — the empty state is the
                moment to offer push (the prompt gates itself on the
                VAPID check) and email capture (capture only). */}
            <div className="mt-6">
              <PushOptInPrompt context="home" />
            </div>
            <div className="mt-6">
              <NewsletterCapture source="notifications" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={n.status === 'sent' || isNotificationRead(n) ? 'opacity-70' : ''}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {n.channel === 'email' ? <Mail className="h-4 w-4 text-muted-foreground" /> : <Bell className="h-4 w-4 text-muted-foreground" />}
                    {n.subject ?? n.type}
                  </CardTitle>
                  <Badge variant={n.status === 'sent' ? 'secondary' : 'default'}>
                    {n.status}
                  </Badge>
                </div>
                <CardDescription>{n.body}</CardDescription>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(n.scheduledFor).toLocaleString()}
                </div>
                <div className="mt-2">
                  {isNotificationRead(n) ? (
                    <Button size="sm" variant="ghost" onClick={() => markAsRead(n.id, false)}>
                      Mark as unread
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => markAsRead(n.id, true)}>
                      <CheckCheck className="mr-2 h-4 w-4" /> Mark as read
                    </Button>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
