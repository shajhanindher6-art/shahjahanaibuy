'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Mail, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';
import {
  NOTIFICATIONS_CHANGED_EVENT,
  NOTIFICATIONS_DEFAULT_LIMIT,
  isNotificationRead,
  notificationTypeOptions,
  type NotificationEntry,
} from '@/lib/notifications';

/** Read-state change broadcast — the sidebar badge listens for it. */
function notifyNotificationsChanged() {
  try {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  } catch {
    // Non-browser render: no sidebar to refresh.
  }
}

type ReadFilter = 'all' | 'read' | 'unread';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [page, setPage] = useState(0);
  // Types seen in the loaded rows only — the filter list never
  // invents a type the mailbox has never contained.
  const [typeOptions, setTypeOptions] = useState<string[]>([]);

  const fetchNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(NOTIFICATIONS_DEFAULT_LIMIT));
      params.set('offset', String(page * NOTIFICATIONS_DEFAULT_LIMIT));
      if (typeFilter) params.set('type', typeFilter);
      if (readFilter !== 'all') params.set('read', readFilter);
      const res = await fetch(`/api/v1/notifications?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        const rows = (data.data ?? []) as NotificationEntry[];
        setNotifications(rows);
        setTotal(typeof data.meta?.total === 'number' ? data.meta.total : rows.length);
        setUnreadCount(typeof data.meta?.unreadCount === 'number' ? data.meta.unreadCount : 0);
        // Merge newly seen types into the filter options so the
        // list only grows from real rows, never from a guess.
        setTypeOptions((prev) => {
          const merged = new Set([...prev, ...notificationTypeOptions(rows)]);
          return [...merged].sort((a, b) => a.localeCompare(b));
        });
      }
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, readFilter]);

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
      if (res.ok) {
        notifyNotificationsChanged();
        fetchNotifications();
      }
    } catch {
      // The row keeps its previous state; retry from the button.
    }
  }, [fetchNotifications]);

  // Section 14, Chunk 1 — bulk mark-all-read: one POST to
  // /api/v1/notifications/read-all replaces the old N-PATCH fan-out.
  const markAllAsRead = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
      if (res.ok) {
        notifyNotificationsChanged();
        fetchNotifications();
      }
    } catch {
      // Nothing changed; the button stays available for retry.
    }
  }, [fetchNotifications]);

  const totalPages = Math.max(1, Math.ceil(total / NOTIFICATIONS_DEFAULT_LIMIT));
  const hasUnread = unreadCount > 0;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          Notifications
          {hasUnread && (
            <Badge variant="default" aria-label={`${unreadCount} unread notifications`}>
              {unreadCount > 99 ? '99+' : unreadCount} unread
            </Badge>
          )}
        </h1>
        {hasUnread && (
          <Button size="sm" variant="outline" onClick={markAllAsRead}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all as read
          </Button>
        )}
      </div>

      {/* Section 14, Chunk 1 — list filters. Type options come from
          types actually seen in loaded rows; read/unread filters the
          server-side list. Changing a filter resets to page 1. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="notifications-type-filter">
          Filter by type
        </label>
        <select
          id="notifications-type-filter"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="notifications-read-filter">
          Filter by read state
        </label>
        <select
          id="notifications-read-filter"
          value={readFilter}
          onChange={(e) => {
            setReadFilter(e.target.value as ReadFilter);
            setPage(0);
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All notifications</option>
          <option value="unread">Unread only</option>
          <option value="read">Read only</option>
        </select>
        {(typeFilter !== '' || readFilter !== 'all') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTypeFilter('');
              setReadFilter('all');
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Bell}
              title="No notifications"
              description={
                typeFilter !== '' || readFilter !== 'all'
                  ? 'Nothing matches the filters you selected. Clear them to see all notifications again.'
                  : "You'll see price alerts, deal notifications, and weekly digests here."
              }
              action={
                typeFilter !== '' || readFilter !== 'all' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTypeFilter('');
                      setReadFilter('all');
                      setPage(0);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Button size="sm" asChild>
                      <Link href="/search">Find a product to watch</Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/tools/price-drop-digest">View your price-drop digest</Link>
                    </Button>
                  </div>
                )
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
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
