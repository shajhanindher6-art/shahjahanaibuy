'use client';

/**
 * Role-based access control hook.
 * Provides permission checking utilities based on the current user's role.
 */

import { useAuth } from './auth-provider';
import type { UserRole } from '@/types';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  guest: 0,
  user: 1,
  premium: 2,
  merchant: 3,
  admin: 4,
};

export function useRole() {
  const { role, isAuthenticated } = useAuth();

  const hasRole = (required: UserRole): boolean => {
    if (!isAuthenticated && required !== 'guest') return false;
    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
  };

  const hasAnyRole = (roles: UserRole[]): boolean => {
    return roles.some((r) => role === r);
  };

  const isAdmin = role === 'admin';
  const isMerchant = role === 'merchant';
  const isPremium = role === 'premium';
  const isUser = role === 'user';
  const isGuest = role === 'guest';

  return {
    role,
    hasRole,
    hasAnyRole,
    isAdmin,
    isMerchant,
    isPremium,
    isUser,
    isGuest,
  };
}
