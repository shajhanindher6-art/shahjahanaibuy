'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCheck, Mail, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

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
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You'll see price alerts, deal notifications, and weekly digests here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id} className={n.status === 'sent' ? 'opacity-70' : ''}>
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
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
