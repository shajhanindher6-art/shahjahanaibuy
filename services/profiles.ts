/**
 * Profiles data access service.
 * Abstracts all profile-related database operations.
 */

import type { Profile, UserRole } from '@/types';
import type { AnySupabaseClient } from '@/lib/supabase/types';

export interface UpdateProfileInput {
  fullName?: string;
  avatarUrl?: string;
  bio?: string;
}

export async function getProfile(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      `
      id,
      email,
      full_name,
      avatar_url,
      bio,
      role_id,
      roles ( name ),
      created_at,
      updated_at
    `
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch profile: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    userId: data.id,
    email: data.email,
    fullName: data.full_name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    role: ((data.roles as unknown as { name: string })?.name ?? 'user') as UserRole,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function updateProfile(
  supabase: AnySupabaseClient,
  userId: string,
  input: UpdateProfileInput
): Promise<Profile | null> {
  const updateData: Record<string, unknown> = {};
  if (input.fullName !== undefined) updateData.full_name = input.fullName;
  if (input.avatarUrl !== undefined) updateData.avatar_url = input.avatarUrl;
  if (input.bio !== undefined) updateData.bio = input.bio;

  const { data, error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', userId)
    .select('id, email, full_name, avatar_url, bio, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }

  return data as Profile | null;
}
