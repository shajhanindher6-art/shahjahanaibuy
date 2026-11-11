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
  /** Creator storefront slug (migration 033, unique when set).
      Pass null to clear the storefront. */
  creatorSlug?: string | null;
  /** Creator storefront bio (migration 033). Pass null to clear. */
  creatorBio?: string | null;
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

  // Section 13, item 59 — creator storefront fields (migration
  // 033). Read best-effort in a separate query so a database where
  // 033 has not run yet keeps loading profiles exactly as before:
  // a missing-column error here just means "no storefront", never
  // a broken profile load. (The main select above deliberately
  // does not list them for the same reason.)
  let creatorSlug: string | null = null;
  let creatorBio: string | null = null;
  try {
    const { data: creatorData, error: creatorError } = await supabase
      .from('profiles')
      .select('creator_slug, creator_bio')
      .eq('id', userId)
      .maybeSingle();
    if (!creatorError && creatorData) {
      creatorSlug = (creatorData as { creator_slug?: string | null }).creator_slug ?? null;
      creatorBio = (creatorData as { creator_bio?: string | null }).creator_bio ?? null;
    }
  } catch {
    // No storefront fields — profile still loads.
  }

  return {
    id: data.id,
    userId: data.id,
    email: data.email,
    fullName: data.full_name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    creatorSlug,
    creatorBio,
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
  // Section 13, item 59 — creator storefront fields (migration
  // 033). Null clears the field (slug cleared = no storefront).
  if (input.creatorSlug !== undefined) updateData.creator_slug = input.creatorSlug;
  if (input.creatorBio !== undefined) updateData.creator_bio = input.creatorBio;

  // The returning select lists the creator columns when they were
  // part of the update; on a database where migration 033 has not
  // run yet that select fails with "column does not exist" (42703)
  // even though the update itself succeeded — so retry without
  // them instead of reporting a failed save.
  const withCreatorColumns =
    'id, email, full_name, avatar_url, bio, creator_slug, creator_bio, created_at, updated_at';
  const baseColumns = 'id, email, full_name, avatar_url, bio, created_at, updated_at';
  let { data, error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', userId)
    .select(updateData.creator_slug !== undefined || updateData.creator_bio !== undefined ? withCreatorColumns : baseColumns)
    .maybeSingle();
  if (error && (error as { code?: string }).code === '42703') {
    ({ data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select(baseColumns)
      .maybeSingle());
  }

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }

  return data as Profile | null;
}
