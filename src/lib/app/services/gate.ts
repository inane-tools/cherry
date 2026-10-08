// Auth gate: what a signed-out visitor may and may not do.
//
// Cherry is a client for a **Premium YouTube Music account** whose library,
// home feed and playback all come from that account. Without a session the
// Innertube API returns anonymous results whose streams cannot be played
// (they are PO-token gated), so instead of letting search appear to work and
// then fail on play, both are blocked up front with a single clear message.

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

/**
 * Report a blocked action to the user: emitted on a global event that the app
 * chrome listens to and shows as a transient notice.
 */
export function announceSignInRequired(): void {
  const detail = { message: SIGN_IN_REQUIRED };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cherry:notice', { detail }));
  }
  // eslint-disable-next-line no-console
  console.info('[cherry]', SIGN_IN_REQUIRED);
}
