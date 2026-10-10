// Auth service: the user's real music.youtube.com session.
// Two ways in: (1) in-app YouTube Music sign-in — the window is watched via
// the native cookie store (HttpOnly included) and the session is captured on
// success; (2) paste a `Cookie` header manually. Either way the secret lands
// in the OS keychain via Rust commands, never localStorage.

import { writable } from 'svelte/store';
import type { AuthSession } from '$lib/core/models';
import { clearStreamCache, getInnertube, resetInnertubeClient } from '$lib/infra/ytmusic/InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
import { clearQueue } from './queue';
import { clearStoredQueue } from './queuePersistence';
import { invokeSafe, invokeStrict, isTauri } from './platform';

export const authStore = writable<AuthSession | null>(null);
export type AuthStatus = 'checking' | 'signed-out' | 'signed-in' | 'error';
export const authStatus = writable<AuthStatus>('checking');

async function persist(session: AuthSession): Promise<void> {
  if (isTauri()) {
    await invokeStrict('auth_save', { session });
  } else {
    // Browser dev fallback (not secure — dev only).
    try {
      sessionStorage.setItem('cherry.auth.dev', JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }
  authStore.set(session);
  authStatus.set('signed-in');
}

function plausibleCookie(cookie: string): boolean {
  return /(SID|SSID|SAPISID|LOGIN_INFO|__Secure-)=/i.test(cookie) && cookie.length > 40;
}

/** Call once at startup: restores the session, dropping dead cookies. */
export async function initAuth(): Promise<AuthSession | null> {
  return restoreAuth();
}

export async function restoreAuth(): Promise<AuthSession | null> {
  let saved: AuthSession | null = null;
  if (isTauri()) {
    // The OS keychain can fail transiently (a concurrent write, a locked
    // store). Retry before deciding there is no session — a single hiccup must
    // not look like being signed out.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        saved = await invokeStrict<AuthSession | null>('auth_load');
        break;
      } catch (e) {
        if (attempt === 2) console.warn('[cherry] could not read the stored session:', e);
        else await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
  } else {
    try {
      const raw = sessionStorage.getItem('cherry.auth.dev');
      if (raw) saved = JSON.parse(raw) as AuthSession;
    } catch {
      /* ignore */
    }
  }

  if (!saved?.cookie) {
    authStatus.set('signed-out');
    return null;
  }
  if (!plausibleCookie(saved.cookie)) {
    // Keep it on disk. A malformed/partial cookie must never silently delete
    // the user's saved session — signing out is an explicit action.
    console.warn('[cherry] stored session looks malformed; staying signed out');
    authStatus.set('signed-out');
    return null;
  }
  // Do not validate the network during startup. A transient YouTube/network
  // failure must not erase a valid keychain session. Playback/search will
  // report the connection error and retry once the network is available.
  authStore.set(saved);
  authStatus.set('signed-in');
  return saved;
}

/** Opens the in-app YouTube Music login window (music.youtube.com). */
export async function beginYtmLogin(): Promise<void> {
  resetInnertubeClient();
  await invokeStrict('open_ytm_login');
}

export interface YtmLoginStatus {
  open: boolean;
  url: string;
  loggedIn: boolean;
}

export async function pollYtmStatus(): Promise<YtmLoginStatus> {
  try {
    return await invokeStrict<YtmLoginStatus>('ytm_login_status');
  } catch {
    return { open: false, url: '', loggedIn: false };
  }
}

/** Reads the session cookies from the login window, persists them, closes it. */
export async function finishYtmLogin(accountLabel?: string): Promise<AuthSession> {
  // Rust already captured and persisted the session; only write again when a
  // label needs to be added. Re-saving the (multi-KB) payload twice in quick
  // succession is what triggered the transient Windows credential failures.
  const session = await invokeStrict<AuthSession>('ytm_login_finish');
  resetInnertubeClient();
  const label = accountLabel?.trim();
  if (label) {
    await persist({ ...session, accountLabel: label });
  } else {
    authStore.set(session);
    authStatus.set('signed-in');
  }
  return session;
}

export function cancelYtmLogin(): void {
  if (isTauri()) void invokeSafe('close_ytm_login');
}

/** Manual fallback: raw `Cookie` header pasted from music.youtube.com. */
export async function signInWithCookie(rawCookie: string, accountLabel?: string): Promise<AuthSession> {
  const cookie = rawCookie.trim().replace(/^cookie:\s*/i, '');
  if (!plausibleCookie(cookie)) {
    throw new Error(
      'That does not look like a YouTube Music session. In music.youtube.com DevTools → Network, copy the full `Cookie` request header.',
    );
  }
  const session: AuthSession = { kind: 'cookie', cookie, accountLabel: accountLabel?.trim() || undefined, savedAt: Date.now() };
  resetInnertubeClient();
  await persist(session);
  // Client construction is intentionally best-effort; the session remains
  // saved so playback/search can report the real API error if needed.
  await getInnertube(session).catch(() => undefined);
  return session;
}

export async function signOut(): Promise<void> {
  // Do not report success or discard the live session if its persisted copy
  // could not be deleted: it would otherwise return on the next launch.
  if (isTauri()) {
    await invokeStrict('auth_clear');
  } else {
    sessionStorage.removeItem('cherry.auth.dev');
  }
  resetInnertubeClient();
  clearStreamCache();
  // Everything cached belongs to the account that is being removed.
  cacheClear();
  // The queue is per-account session state; drop it (and its persisted copy)
  // so the next sign-in does not resume the previous account's music.
  clearQueue();
  clearStoredQueue();
  authStore.set(null);
  authStatus.set('signed-out');
}
