// Auth gate: what a signed-out visitor may and may not do.
//
// Cherry is a client for a **Premium YouTube Music account** whose library,
// home feed and playback all come from that account. Without a session the
// Innertube API returns anonymous results whose streams cannot be played
// (they are PO-token gated), so instead of letting search appear to work and
// then fail on play, both are blocked up front with a single clear message.

import { get } from 'svelte/store';
import { authStore } from './auth';

export const SIGN_IN_REQUIRED = 'Sign in with YouTube Music in Settings to use Cherry.';

/**
 * Legal disclaimer. Shared so the welcome gate (which requires accepting it) and
 * the Settings screen (which displays it) can never drift apart.
 */
export const DISCLAIMER =
  'Cherry is an unofficial client and is not affiliated with, endorsed by, or associated with ' +
  'YouTube, Google or YouTube Music. All trademarks and content belong to their respective owners. ' +
  'Cherry needs your own account and a valid Premium subscription to play music. You are responsible ' +
  'for how you use Cherry and for any consequences, including any effect on your account. ' +
  'The software is provided as is, without warranty of any kind.';

/** True when a session is loaded (not merely "a cookie exists on disk"). */
export function isSignedIn(): boolean {
  return get(authStore) !== null;
}

/**
 * Run `action` only when signed in.
 *
 * Returns `false` (and takes no action) when signed out, so callers can pass
 * this straight into a click handler. `onBlocked` is how the UI surfaces the
 * reason without every caller re-implementing the message.
 */
export function requireAuth(action: () => void, onBlocked?: (reason: string) => void): boolean {
  if (isSignedIn()) {
    action();
    return true;
  }
  onBlocked?.(SIGN_IN_REQUIRED);
  return false;
}

/** Take the user to Settings (where the sign-in button lives). */
export async function goToSignIn(): Promise<void> {
  // Imported lazily: navigation imports the auth store, and a static import
  // here would make this module part of that cycle.
  const { go } = await import('./navigation');
  go('settings');
}

/**
 * Report a blocked action to the user.
 *
 * A Toast component is not part of the app yet, so the message is emitted on a
 * global event the chrome listens to; failing that it falls back to a
 * console warning so the gate is never *silent*.
 */
export function announceSignInRequired(): void {
  const detail = { message: SIGN_IN_REQUIRED };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cherry:notice', { detail }));
  }
  // eslint-disable-next-line no-console
  console.info('[cherry]', SIGN_IN_REQUIRED);
}
