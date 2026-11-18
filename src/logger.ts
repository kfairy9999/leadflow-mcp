export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEYS = new Set([
  'email',
  'phone',
  'contactname',
  'contact_name',
  'notes',
  'summary',
  'reason',
  'address',
  'name',
  'text',
  'body',
  'authorization',
  'token',
  'auth',
  'password',
  'secret',
]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;
const BEARER = /\bBearer\s+\S+/gi;

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = REDACT_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(inner, depth + 1);
    }
    return out;
  }
  return '[unloggable]';
}

export function redactString(value: string): string {
  return value
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]')
    .replace(BEARER, 'Bearer [redacted]');
}

export function createLogger(
  options: {
    level?: LogLevel;
    write?: (line: string) => void;
    base?: Record<string, unknown>;
  } = {},
): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? ((line: string) => console.error(line));
  const base = options.base ?? {};

  const emit = (entryLevel: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (RANK[entryLevel] < RANK[level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      event: redactString(event),
      ...asRecord(redact({ ...base, ...fields })),
    };
    write(`${JSON.stringify(payload)}\n`);
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

export function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value === '') return 'info';
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  throw new Error(`LEADFLOW_LOG_LEVEL must be debug, info, warn, or error. Received "${value}".`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}
