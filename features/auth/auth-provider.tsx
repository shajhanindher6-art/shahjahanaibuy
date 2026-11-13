'use client';

/**
 * Authentication context provider.
 * Manages Supabase auth state, profile data, and role-based access.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getProfile } from '@/services/profiles';
import { runGuestMerge } from '@/lib/guest-merge';
import { mapSignUpErrorMessage } from '@/lib/auth/error-messages';
import { readCaptchaToken } from '@/lib/auth/captcha-client';
import { mapAuthError } from './auth-errors';
import type { AuthContextValue, AuthResult } from '@/types/auth';
import type { Profile, UserRole } from '@/types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Section 18, item 57 — every auth failure goes through the
 * friendly mapper: no raw Supabase text ever leaves the provider.
 * `fallback` is the generic message used when nothing matches.
 */
function authFailure(error: unknown, fallback: string): AuthResult {
  const mapped = mapAuthError(
    error as { code?: string; message?: string } | string | null | undefined,
    fallback
  );
  return { success: false, error: mapped.message, errorCode: mapped.code };
}


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
    let initialSessionChecked = false;

    // First, check the existing session synchronously from localStorage/cookie.
    // This resolves immediately (no network round-trip) and sets the user
    // state before any navigation happens.
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      initialSessionChecked = true;
      setUser(session?.user ?? null);
      if (session?.user) {
        // Section 12, Chunk B — guest → signed-in merge: a returning
        // session (or an OAuth callback that already exchanged the
        // code) still carries any guest saves left on this device.
        // runGuestMerge is a no-op when the guest stores are empty
        // and re-reads server state first, so a retry after a
        // failed merge is safe.
        void runGuestMerge();
        fetchProfile(session.user.id).finally(() => mounted && setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth state changes (sign-in, sign-out, token refresh).
    // The critical fix: do NOT set isLoading=false here on the INITIAL event.
    // onAuthStateChange fires an INITIAL_SESSION event on mount, which races
    // with getSession() above. If it fires with no session before getSession
    // resolves, it would prematurely set isLoading=false with user=null,
    // causing ProtectedRoute to redirect to /sign-in even when the user is
    // actually authenticated.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: string, session: Session | null) => {
        if (!mounted) return;

        // Skip the initial INITIAL_SESSION event — getSession() handles that.
        if (event === 'INITIAL_SESSION' && !initialSessionChecked) return;

        (async () => {
          setUser(session?.user ?? null);
          if (session?.user) {
            // Section 12, Chunk B — guest → signed-in merge: SIGNED_IN
            // is the single funnel for a fresh password sign-in and
            // for the Google OAuth code exchange landing on
            // /auth/callback, so the merge runs once here for both.
            // Fire-and-forget on purpose: the merge must never block
            // sign-in, and it never throws. TOKEN_REFRESHED is
            // deliberately excluded — a refresh is not a sign-in.
            if (event === 'SIGNED_IN') void runGuestMerge();
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
      // Section 21–25, Stage J, J-P1-1 — sign-in goes through the
      // rate-limited server proxy (/api/v1/auth/sign-in, 5/min/IP)
      // instead of browser → Supabase directly. The proxy sets the
      // session cookies server-side and returns the session tokens;
      // setSession() establishes the browser session, then the flow
      // continues exactly as before (profile fetch, guest merge via
      // the SIGNED_IN listener). A 429/401 from the proxy is
      // honoured, never bypassed. Only a network failure reaching
      // the proxy falls back to the direct call, so a proxy outage
      // cannot lock every user out of sign-in.
      const captchaToken = readCaptchaToken();
      try {
        let res: Response;
        try {
          res = await fetch('/api/v1/auth/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password,
              ...(captchaToken ? { captchaToken } : {}),
            }),
          });
        } catch {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) return authFailure(error, 'Failed to sign in. Check your connection and try again.');
          if (data.user) {
            setUser(data.user);
            await fetchProfile(data.user.id);
          }
          return { success: true };
        }
        const payload = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: {
            user?: { id?: string | null; email?: string | null };
            session?: { access_token?: string; refresh_token?: string } | null;
          } | null;
          error?: { message?: string };
        } | null;
        if (!res.ok || !payload?.success) {
          return authFailure(
            payload?.error?.message ?? 'Invalid email or password.',
            'Failed to sign in. Check your connection and try again.'
          );
        }
        const session = payload.data?.session;
        if (session?.access_token && session?.refresh_token) {
          const { data: sessionData } = await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
          if (sessionData.user) {
            setUser(sessionData.user);
            await fetchProfile(sessionData.user.id);
          }
        } else if (payload.data?.user?.id) {
          // No tokens (should not happen) — re-read the session
          // the proxy set via cookies.
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData.session?.user) {
            setUser(sessionData.session.user);
            await fetchProfile(sessionData.session.user.id);
          }
        }
        return { success: true };
      } catch (err) {
        return authFailure(err, 'Failed to sign in. Check your connection and try again.');
      }
    },
    [supabase, fetchProfile]
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string): Promise<AuthResult> => {
      // Section 21–25, Stage J, J-P1-1 — same proxy pattern as
      // signIn: /api/v1/auth/sign-up (5/min/IP, anti-enumeration —
      // an existing email gets the same success shape as a fresh
      // one). Response shapes are unchanged, so the sign-up page
      // branches exactly as before.
      const captchaToken = readCaptchaToken();
      try {
        let res: Response;
        try {
          res = await fetch('/api/v1/auth/sign-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password,
              ...(fullName !== undefined ? { fullName } : {}),
              ...(captchaToken ? { captchaToken } : {}),
            }),
          });
        } catch {
          // Proxy unreachable — direct fallback (see signIn).
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName ?? '' },
            },
          });
          if (error) {
            const generic = mapSignUpErrorMessage(error.message);
            if (generic) return { success: true, error: generic };
            return authFailure(error, 'Failed to create your account. Check your connection and try again.');
          }
          if (!data.session) {
            return {
              success: true,
              error: 'Account created! Check your email to confirm your account.',
            };
          }
          if (data.user) {
            setUser(data.user);
            await fetchProfile(data.user.id);
          }
          return { success: true };
        }
        const payload = (await res.json().catch(() => null)) as {
          success?: boolean;
          data?: {
            user?: { id?: string | null; email?: string | null };
            session?: { access_token?: string; refresh_token?: string } | null;
            message?: string;
          } | null;
          error?: { message?: string };
        } | null;
        if (!res.ok || !payload?.success) {
          // Section 18, Phase 2, item 5 (audit §1 #55): Supabase
          // returns "User already registered" for an existing email,
          // which would let an attacker enumerate registered emails.
          // That error is mapped to the same generic "check your
          // email" wording a fresh sign-up shows, reported as a
          // success-with-message — indistinguishable from a new
          // account creation. This runs before the generic
          // authFailure mapper: the point is not just friendly copy,
          // but the success shape itself.
          const generic = mapSignUpErrorMessage(payload?.error?.message ?? '');
          if (generic) return { success: true, error: generic };
          return authFailure(
            payload?.error?.message ?? 'Failed to create your account.',
            'Failed to create your account. Check your connection and try again.'
          );
        }
        if (payload.data?.message) {
          return { success: true, error: payload.data.message };
        }
        const session = payload.data?.session;
        if (session?.access_token && session?.refresh_token) {
          const { data: sessionData } = await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
          if (sessionData.user) {
            setUser(sessionData.user);
            await fetchProfile(sessionData.user.id);
          }
          return { success: true };
        }
        return {
          success: true,
          error: 'Account created! Check your email to confirm your account.',
        };
      } catch (err) {
        return authFailure(err, 'Failed to create your account. Check your connection and try again.');
      }
    },
    [supabase, fetchProfile]
  );

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) return authFailure(error, 'Google Sign-In is not available. Please use email/password.');
      return { success: true };
    } catch (err) {
      return authFailure(err, 'Google Sign-In is not available. Please use email/password.');
    }
  }, [supabase]);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
  }, [supabase]);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
        });
        if (error) return authFailure(error, 'Failed to send the reset email. Check your connection and try again.');
        return { success: true };
      } catch (err) {
        return authFailure(err, 'Failed to send the reset email. Check your connection and try again.');
      }
    },
    [supabase]
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return authFailure(error, 'Failed to update your password. Check your connection and try again.');
        return { success: true };
      } catch (err) {
        return authFailure(err, 'Failed to update your password. Check your connection and try again.');
      }
    },
    [supabase]
  );

  const resendVerification = useCallback(
    async (email: string): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
        });
        if (error) return authFailure(error, 'Failed to resend the verification email. Check your connection and try again.');
        return { success: true };
      } catch (err) {
        return authFailure(err, 'Failed to resend the verification email. Check your connection and try again.');
      }
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
