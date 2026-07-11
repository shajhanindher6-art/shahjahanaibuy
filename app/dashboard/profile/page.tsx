'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/features/auth';
import { updateProfile } from '@/services/profiles';
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

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName ?? '');
      setBio(profile.bio ?? '');
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    try {
      await updateProfile(getSupabaseBrowserClient(), user.id, { fullName, bio });
      await refreshProfile();
      toast({ title: 'Profile updated', description: 'Your profile has been saved.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [user, fullName, bio, refreshProfile, toast]);

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
