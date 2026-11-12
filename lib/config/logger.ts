/**
 * Centralized logging utility.
 *
 * Structured JSON lines: every record is ONE JSON object per line
 * (`{ timestamp, level, message, ...meta }`) so Vercel logs (and any
 * future log pipeline) can parse and filter by field instead of
 * grepping text. There is NO external log sink — Vercel logs only;
 * the old header's "a Logtail/Datadog integration would exist in
 * production" was aspirational, not real, and is not added here
 * (Section 18, item 56).
 *
 * PII masking: meta values under a sensitive key are replaced with
 * `[REDACTED]` before serialisation (see SENSITIVE_KEYS). Masking
 * covers keys, not free-text messages — never put a secret, token,
 * or password inside a log *message* either.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'key',
  'authorization',
  'email',
  'phone',
  'ssn',
  'credit_card',
  'apikey',
];

/**
 * Recursively replace values under sensitive keys with '[REDACTED]'.
 * A key matches when it CONTAINS a sensitive token (case-insensitive),
 * so `userPassword`, `apiKey`, `toEmail`, `authToken` are all masked.
 * Exported for tests (Section 18, item 56) — call sites use `logger`.
 */
export function maskSensitive(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(maskSensitive);

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      masked[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      masked[key] = maskSensitive(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/**
 * One JSON object per line: `{ timestamp, level, message, ...meta }`.
 * The base fields always win on a key collision — a meta field named
 * `level` or `message` can never rewrite the record's own level or
 * message. Meta is masked first (see maskSensitive).
 */
function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const maskedMeta = meta ? (maskSensitive(meta) as Record<string, unknown>) : {};
  return JSON.stringify({
    ...maskedMeta,
    timestamp: new Date().toISOString(),
    level,
    message,
  });
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.debug) {
      console.debug(formatMessage('debug', message, meta));
    }
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.info) {
      console.info(formatMessage('info', message, meta));
    }
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, meta));
    }
  },
};
