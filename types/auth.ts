/**
 * Authentication and session types.
 */

import type { User } from '@supabase/supabase-js';
import type { UserRole, Profile } from './index';
import type { AuthErrorCode } from '@/features/auth/auth-errors';

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, fullName?: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  /**
   * Section 18, item 57 — machine-readable code for the mapped
   * error (e.g. 'email-not-confirmed'), so pages can branch on it
   * instead of string-matching the message. Undefined on success.
   */
  errorCode?: AuthErrorCode;
}
