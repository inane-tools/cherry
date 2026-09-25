// Typed errors so UI can show actionable messages.

export type CherryErrorCode =
  | 'auth-required'
  | 'auth-invalid'
  | 'network'
  | 'stream-unavailable'
  | 'rate-limited'
  | 'not-found'
  | 'internal';

export class CherryError extends Error {
  readonly code: CherryErrorCode;
  readonly cause?: unknown;

  constructor(code: CherryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CherryError';
    this.code = code;
    this.cause = cause;
  }
}

export function toCherryError(e: unknown, fallback = 'Something went wrong'): CherryError {
  if (e instanceof CherryError) return e;
  const msg = e instanceof Error ? e.message : String(e ?? fallback);
  if (/401|403|login|cookie|auth/i.test(msg)) return new CherryError('auth-required', msg, e);
  if (/429|rate/i.test(msg)) return new CherryError('rate-limited', msg, e);
  if (/404|not found/i.test(msg)) return new CherryError('not-found', msg, e);
  if (/network|fetch|failed/i.test(msg)) return new CherryError('network', msg, e);
  return new CherryError('internal', msg || fallback, e);
}
