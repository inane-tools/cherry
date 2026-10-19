import { describe, expect, it } from 'vitest';
import { CherryError, isRegionRestricted, toCherryError } from './errors';

const code = (message: unknown) => toCherryError(message instanceof Error ? message : new Error(String(message))).code;

describe('toCherryError', () => {
  it('recognizes explicit region restrictions in player responses and library errors', () => {
    for (const reason of [
      'This video is not available in your country.',
      'The uploader has not made this video available in your country.',
      'This content is blocked in your region.',
      'Region-restricted',
    ]) {
      const error = Object.assign(new Error('This video is unavailable'), { info: { error_screen: { subreason: { text: reason } } } });
      expect(isRegionRestricted(error)).toBe(true);
      expect(toCherryError(error).code).toBe('region-restricted');
    }
    expect(isRegionRestricted(new Error('This track is unavailable (region / age restriction?).'))).toBe(false);
    expect(isRegionRestricted(new Error('403 Forbidden'))).toBe(false);
    expect(isRegionRestricted(new Error('Failed to fetch'))).toBe(false);
    expect(isRegionRestricted(new Error('Please sign in to confirm your age.'))).toBe(false);
  });
  it('passes CherryErrors through unchanged', () => {
    const original = new CherryError('stream-unavailable', 'nope');
    expect(toCherryError(original)).toBe(original);
  });

  it('classifies common failures', () => {
    expect(code('Request failed with status 403')).toBe('auth-required');
    expect(code('Please log in again')).toBe('auth-required');
    expect(code('Invalid cookie')).toBe('auth-required');
    expect(code('Authentication required')).toBe('auth-required');
    expect(code('HTTP 429 Too Many Requests')).toBe('rate-limited');
    expect(code('Rate limit exceeded')).toBe('rate-limited');
    expect(code('HTTP 404')).toBe('not-found');
    expect(code('Failed to fetch')).toBe('network');
    expect(code('something odd')).toBe('internal');
  });

  // Regression: bare substrings misclassified unrelated messages.
  it('does not mistake words that merely contain the keywords', () => {
    expect(code('Unknown author field')).toBe('internal');
    expect(code('Could not generate the list')).toBe('internal');
    expect(code('Moderate traffic')).toBe('internal');
    expect(code('Error 14030')).toBe('internal');
  });

  it('accepts non-Error values', () => {
    expect(toCherryError('plain string 403').code).toBe('auth-required');
    expect(toCherryError(undefined).message).toBe('Something went wrong');
  });
});
