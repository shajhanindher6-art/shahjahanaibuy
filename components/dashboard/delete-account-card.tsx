/**
 * Delete-account card (Section 14, Chunk 7) — settings page.
 *
 * Permanently deletes the signed-in user's account and data
 * (DELETE /api/v1/account). The user must type DELETE exactly —
 * the button stays disabled until they do — and the card lists
 * what is deleted before they confirm. Deletion is permanent and
 * irreversible: there is no restore and no grace period. If the
 * server is not configured for deletion (no service-role key) the
 * API answers 503 and deletes nothing, and the card says so.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth';
import { useToast } from '@/hooks/use-toast';
import {
  DELETE_CONFIRMATION_TEXT,
  describeDeletionScope,
  isValidDeleteConfirmation,
} from '@/lib/account-deletion';

export function DeleteAccountCard() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = isValidDeleteConfirmation(confirm);

  async function handleDelete() {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: DELETE_CONFIRMATION_TEXT }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(
          (json?.message as string | undefined) ??
            'Account deletion failed. Nothing was deleted — please try again.'
        );
        return;
      }
      toast({ title: 'Your account has been deleted.' });
      await signOut();
      router.push('/');
    } catch {
      setError('Account deletion failed. Nothing was deleted — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-200 dark:border-red-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <Trash2 className="h-5 w-5" /> Delete my account
        </CardTitle>
        <CardDescription>
          Permanently delete your SmartBuy account and all of your data. This cannot be
          undone — there is no restore and no grace period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {describeDeletionScope().map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Guest (browser-token) push rows and aggregate referral-click counts are not linked
          to your account and are not deleted.
        </p>
        <div className="space-y-2">
          <Label htmlFor="delete-confirm">
            Type {DELETE_CONFIRMATION_TEXT} to confirm
          </Label>
          <Input
            id="delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={DELETE_CONFIRMATION_TEXT}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button
          variant="destructive"
          onClick={() => void handleDelete()}
          disabled={!valid || busy}
        >
          {busy ? 'Deleting…' : 'Delete my account permanently'}
        </Button>
      </CardContent>
    </Card>
  );
}
