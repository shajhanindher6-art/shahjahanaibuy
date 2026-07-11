'use client';

/**
 * Authentication context provider.
 * Manages Supabase auth state, profile data, and role-based access.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getProfile } from '@/services/profiles';
import type { AuthContextValue, AuthResult } from '@/types/auth';
import type { Profile, UserRole } from '@/types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const p = await getProfile(supabase, userId);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => mounted && setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: string, session: Session | null) => {
        (async () => {
          if (!mounted) return;
          setUser(session?.user ?? null);
          if (session?.user) {
            await fetchProfile(session.user.id);
          } else {
            setProfile(null);
          }
          setIsLoading(false);
        })();
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [supabase]
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string): Promise<AuthResult> => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName ?? '' },
        },
      });
      if (error) return { success: false, error: error.message };
      if (!data.session) {
        return {
          success: true,
          error: 'Check your email to confirm your account.',
        };
      }
      return { success: true };
    },
    [supabase]
  );

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }, [supabase]);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
  }, [supabase]);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [supabase]
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [supabase]
  );

  const resendVerification = useCallback(
    async (email: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    },
    [supabase]
  );

  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  const role: UserRole = profile?.role ?? 'guest';

  const value: AuthContextValue = {
    user,
    profile,
    role,
    isLoading,
    isAuthenticated: Boolean(user),
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    resendVerification,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
