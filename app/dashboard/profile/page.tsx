'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { updateProfile } from '@/services/profiles';
import { isValidCreatorSlug } from '@/lib/creator-storefront';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { Save, Mail, Shield } from 'lucide-react';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  // Section 13, item 59 — creator storefront editor. The slug +
  // bio columns exist only in migration 033; until this editor no
  // UI anywhere set them, so a storefront could never be created
  // through the UI.
  const [creatorSlug, setCreatorSlug] = useState('');
  const [creatorBio, setCreatorBio] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? '');
      setBio(profile.bio ?? '');
      setCreatorSlug(profile.creatorSlug ?? '');
      setCreatorBio(profile.creatorBio ?? '');
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    // A slug is optional — but when typed it must be valid
    // (2–64 lowercase letters/digits/hyphens); an empty slug
    // clears the storefront.
    const slug = creatorSlug.trim().toLowerCase();
    if (slug !== '' && !isValidCreatorSlug(slug)) {
      setSlugError(
        'Storefront slug must be 2–64 characters of lowercase letters, digits, and hyphens.'
      );
      return;
    }
    setSlugError(null);
    setSaving(true);
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    try {
      await updateProfile(getSupabaseBrowserClient(), user.id, {
        fullName,
        bio,
        creatorSlug: slug === '' ? null : slug,
        creatorBio: creatorBio.trim() === '' ? null : creatorBio.trim(),
      });
      await refreshProfile();
      toast({ title: 'Profile updated', description: 'Your profile has been saved.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // A duplicate slug hits the migration-033 unique index; a
      // missing column means 033 has not been run yet. Both get a
      // plain explanation instead of a generic failure.
      if (/duplicate|unique/i.test(message)) {
        setSlugError('That storefront slug is already taken — try another one.');
        toast({ title: 'Slug already taken', description: 'Choose a different storefront slug.', variant: 'destructive' });
      } else if (/column .* does not exist|42703/i.test(message)) {
        toast({ title: 'Error', description: 'Creator storefronts are not set up yet — the owner still needs to run migration 033 once.', variant: 'destructive' });
      } else {
        toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  }, [user, fullName, bio, creatorSlug, creatorBio, refreshProfile, toast]);

  if (!profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      {/* Profile Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20">
              <AvatarFallback className="text-2xl font-bold bg-primary text-primary-foreground">
                {fullName?.[0]?.toUpperCase() ?? profile.email[0]?.toUpperCase() ?? 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-semibold">{fullName || 'Anonymous User'}</h2>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <Badge className="mt-2 capitalize" variant="secondary">
                {profile.role}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Edit Profile</CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself"
              rows={4}
            />
          </div>

          {/* Section 13, item 59 — creator storefront. A public
              slug + bio publishes a storefront at /creators/[slug];
              the storefront appears in /creators once the creator
              has at least one verified deal. Clearing the slug
              removes the storefront. */}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="creatorSlug">Creator storefront slug (optional)</Label>
            <Input
              id="creatorSlug"
              value={creatorSlug}
              onChange={(e) => {
                setCreatorSlug(e.target.value.toLowerCase());
                setSlugError(null);
              }}
              placeholder="e.g. gadget-guru"
              maxLength={64}
            />
            {slugError && <p className="text-sm text-red-600">{slugError}</p>}
            <p className="text-xs text-muted-foreground">
              Your public storefront will live at /creators/{creatorSlug.trim().toLowerCase() || 'your-slug'}.
              Leave it empty to remove your storefront.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="creatorBio">Storefront bio (optional)</Label>
            <Textarea
              id="creatorBio"
              value={creatorBio}
              onChange={(e) => setCreatorBio(e.target.value)}
              placeholder="What deals do you share?"
              rows={3}
            />
          </div>
          {profile.creatorSlug && (
            <p className="text-sm text-muted-foreground">
              Your storefront is live at{' '}
              <Link href={`/creators/${profile.creatorSlug}`} className="font-medium text-blue-600 underline">
                View your storefront
              </Link>
            </p>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <LoadingSpinner size="sm" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>Your account details and security status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Email</Label>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>
            {user?.email_confirmed_at ? (
              <Badge variant="secondary" className="text-success">
                Verified
              </Badge>
            ) : (
              <Badge variant="outline">Unverified</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Role</Label>
                <p className="text-sm text-muted-foreground capitalize">{profile.role}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
