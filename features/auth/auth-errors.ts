/**
 * Friendly auth-error mapping (Section 18, item 57 / audit §1 #38).
 *
 * Supabase Auth returns terse provider wording ("Invalid login
 * credentials", "Email not confirmed") that means nothing to a
 * shopper and changes whenever Supabase rewords it. Nothing in the
 * app renders that raw text any more: every auth method maps the
 * error through here first and returns plain English + a next step.
 *
 * The mapping keys off the stable `code` when Supabase supplies one
 * (e.g. `email_not_confirmed`, `invalid_credentials`) and falls back
 * to case-insensitive message matching, so a reworded message still
 * maps as long as its keywords survive. Anything unknown maps to
 * the generic fallback — never the raw provider text.
 *
 * The sign-in page keys its "resend verification email" link off
 * `code === 'email-not-confirmed'` instead of string-matching the
 * raw message (the fragile `'not confirmed'` check this replaces).
 */

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'invalid-email'
  | 'weak-password'
  | 'user-not-found'
  | 'too-many-requests'
  | 'expired-link'
  | 'already-registered'
  | 'generic';

export interface MappedAuthError {
  code: AuthErrorCode;
  /** Plain-English message with a next step. Never raw Supabase text. */
  message: string;
}

const MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials':
    'Incorrect email or password. Check your details and try again.',
  'email-not-confirmed':
    'Your email is not confirmed yet. Check your inbox for the confirmation link, or resend it below.',
  'invalid-email':
    'That email address does not look valid. Check it and try again.',
  'weak-password':
    'That password is too weak. Use at least 8 characters with a mix of letters and numbers.',
  'user-not-found':
    'We could not find an account with that email. Check the address, or create a new account.',
  'too-many-requests':
    'Too many attempts. Wait a few minutes and try again.',
  'expired-link':
    'This link has expired. Request a new one from the sign-in page.',
  'already-registered':
    'An account with this email may already exist. Try signing in, or reset your password if you cannot get in.',
  generic:
    'We could not complete that. Check your connection and try again — if it keeps failing, contact support.',
};

interface SupabaseLikeError {
  code?: string;
  message?: string;
}

function normalise(input: SupabaseLikeError | string | null | undefined): {
  code: string;
  message: string;
} {
  if (typeof input === 'string') return { code: '', message: input };
  return { code: input?.code ?? '', message: input?.message ?? '' };
}

/**
 * Map a Supabase auth error (or a thrown Error, or a plain message
 * string) to a friendly code + message. `fallback` overrides the
 * generic message for a specific call site (e.g. "Failed to send
 * reset email" becomes the generic copy with that context); it is
 * only used when nothing else matches.
 */
export function mapAuthError(
  error: SupabaseLikeError | string | null | undefined,
  fallback?: string
): MappedAuthError {
  const { code, message } = normalise(error);
  const haystack = `${code} ${message}`.toLowerCase();

  let mapped: AuthErrorCode | null = null;
  if (
    haystack.includes('email_not_confirmed') ||
    haystack.includes('email not confirmed') ||
    haystack.includes('not confirmed')
  ) {
    mapped = 'email-not-confirmed';
  } else if (
    haystack.includes('invalid_credentials') ||
    haystack.includes('invalid login credentials') ||
    haystack.includes('invalid login') ||
    haystack.includes('incorrect email or password')
  ) {
    mapped = 'invalid-credentials';
  } else if (
    haystack.includes('invalid_email') ||
    haystack.includes('invalid email') ||
    (haystack.includes('email address') && haystack.includes('invalid'))
  ) {
    mapped = 'invalid-email';
  } else if (
    haystack.includes('weak_password') ||
    haystack.includes('weak password') ||
    haystack.includes('password should be') ||
    haystack.includes('password is too short') ||
    haystack.includes('password must be at least')
  ) {
    mapped = 'weak-password';
  } else if (
    haystack.includes('user_not_found') ||
    haystack.includes('user not found') ||
    haystack.includes('no user found')
  ) {
    mapped = 'user-not-found';
  } else if (
    haystack.includes('too_many_requests') ||
    haystack.includes('too many requests') ||
    haystack.includes('rate limit') ||
    haystack.includes('rate_limit') ||
    haystack.includes('email rate limit')
  ) {
    mapped = 'too-many-requests';
  } else if (
    haystack.includes('expired') ||
    haystack.includes('token has expired') ||
    haystack.includes('link has expired')
  ) {
    mapped = 'expired-link';
  } else if (
    haystack.includes('already registered') ||
    haystack.includes('user already registered') ||
    haystack.includes('user_already_exists')
  ) {
    // Deliberately neutral wording: it does not confirm whether the
    // address is registered (see audit §1 #55).
    mapped = 'already-registered';
  }

  if (mapped) return { code: mapped, message: MESSAGES[mapped] };
  return { code: 'generic', message: fallback ?? MESSAGES.generic };
}

/**
 * Map an OAuth callback failure to plain copy (Section 18, item 59 /
 * audit §1 #40). `errorCode` is the `?error_code=` param (e.g.
 * `access_denied` when the user cancels Google sign-in); the raw
 * `error_description` is NEVER returned — it is provider wording.
 */
export function mapOAuthError(
  errorCode: string | null | undefined,
  _errorDescription?: string | null
): MappedAuthError {
  const code = (errorCode ?? '').toLowerCase().trim();
  switch (code) {
    case 'access_denied':
      return {
        code: 'generic',
        message:
          'You cancelled Google sign-in. Try again, or sign in with your email and password instead.',
      };
    case 'server_error':
      return {
        code: 'generic',
        message:
          'Google sign-in is having a problem right now. Wait a moment and try again, or use email and password.',
      };
    case 'temporarily_unavailable':
      return {
        code: 'generic',
        message:
          'Google sign-in is temporarily unavailable. Try again in a few minutes, or use email and password.',
      };
    case 'invalid_request':
    case 'unauthorized_client':
    case 'unsupported_response_type':
      return {
        code: 'generic',
        message:
          'Google sign-in could not start. Try again, or sign in with your email and password instead.',
      };
    default:
      return {
        code: 'generic',
        message:
          'Google sign-in did not work. Try again, or sign in with your email and password instead.',
      };
  }
}
