/**
 * Centralized logging utility.
 * In production, this would integrate with a structured logging service
 * (e.g. Logtail, Datadog). For Phase 1, it provides structured console
 * output with PII masking.
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

function maskSensitive(data: unknown): unknown {
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

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const maskedMeta = meta ? maskSensitive(meta) : undefined;
  const metaStr = maskedMeta ? ` ${JSON.stringify(maskedMeta)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
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
