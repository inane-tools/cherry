// Typed errors so UI can show actionable messages.

export type CherryErrorCode =
  | 'auth-required'
  | 'auth-invalid'
  | 'network'
  | 'stream-unavailable'
  | 'region-restricted'
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

/** Match explicit geographic restrictions, not generic unavailable/403 errors. */
export function isRegionRestricted(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  let visited = 0;
  while (pending.length && visited++ < 100) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (/\b(?:not\s+available|unavailable|not\s+made[^.!?\n]{0,80}available)\b[^.!?\n]{0,100}\b(?:your|this) (?:country|region|location)\b|\b(?:blocked|restricted)\b[^.!?\n]{0,80}\b(?:country|region|location)\b|\b(?:geo[- ]?(?:blocked|restricted)|region[- ]restricted)\b/i.test(value)) return true;
    } else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      if (value instanceof CherryError && value.code === 'region-restricted') return true;
      if (Array.isArray(value)) pending.push(...value.slice(0, 20));
      else for (const key of ['message', 'reason', 'subreason', 'info', 'cause', 'error_screen', 'errorScreen', 'playerErrorMessageRenderer', 'simpleText', 'text', 'runs']) {
        pending.push((value as Record<string, unknown>)[key]);
      }
    }
  }
  return false;
}

export function toCherryError(e: unknown, fallback = 'Something went wrong'): CherryError {
  if (e instanceof CherryError) return e;
  const msg = e instanceof Error ? e.message : String(e ?? fallback);
  if (isRegionRestricted(e)) return new CherryError('region-restricted', 'This song is not available in your region.', e);
  // Word boundaries matter: a bare /auth/ matched "author" and /rate/ matched
  // "generate", so unrelated failures were reported as sign-in problems.
  if (/\b(401|403)\b|\blog ?in\b|\bcookies?\b|\bauth(?!or)/i.test(msg)) {
    return new CherryError('auth-required', msg, e);
  }
  if (/\b429\b|\brate.?limit/i.test(msg)) return new CherryError('rate-limited', msg, e);
  if (/\b404\b|not found/i.test(msg)) return new CherryError('not-found', msg, e);
  if (/network|fetch|failed/i.test(msg)) return new CherryError('network', msg, e);
  return new CherryError('internal', msg || fallback, e);
}
