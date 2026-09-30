// Last.fm scrobbling (frontend).
//
// The user supplies their own API key + secret and authorizes the app in the
// browser; the resulting session key is kept in settings. All signing and HTTP
// happens in Rust (`lastfm.rs`) — this module is the typed wrapper plus the
// configuration checks that gate the scrobble service.

import { get } from 'svelte/store';
import type { Track } from '$lib/core/models';
import { isTauri } from './platform';
import { settingsStore } from './settings';

async function invokeStrict<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Last.fm scrobbling needs the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function lastfmConfigured(): boolean {
  const s = get(settingsStore);
  return Boolean(s.lastfmApiKey && s.lastfmApiSecret);
}

export function lastfmConnected(): boolean {
  return Boolean(get(settingsStore).lastfmSessionKey);
}

/** True when scrobbling should actually be sent. */
export function lastfmActive(): boolean {
  const s = get(settingsStore);
  return Boolean(s.lastfmEnabled && s.lastfmApiKey && s.lastfmApiSecret && s.lastfmSessionKey);
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/** Step 1: get a request token and open the Last.fm approval page. */
export async function beginAuth(apiKey: string, apiSecret: string): Promise<string> {
  const result = await invokeStrict<{ token: string; authUrl: string }>('lastfm_get_token', {
    apiKey,
    apiSecret,
  });
  await openExternal(result.authUrl);
  return result.token;
}

/** Step 3: exchange the approved token for a long-lived session key. */
export async function completeAuth(
  apiKey: string,
  apiSecret: string,
  token: string,
): Promise<{ sessionKey: string; username: string }> {
  return invokeStrict<{ sessionKey: string; username: string }>('lastfm_get_session', {
    apiKey,
    apiSecret,
    token,
  });
}

function artistLine(track: Track): string {
  return track.artists.map((a) => a.name).join(', ') || 'Unknown artist';
}

export interface ScrobbleFields {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
}

export function fieldsFromTrack(track: Track): ScrobbleFields {
  return {
    artist: artistLine(track),
    track: track.title,
    album: track.album?.name || undefined,
    duration: track.durationSeconds ? Math.round(track.durationSeconds) : undefined,
  };
}

/** Best-effort "now playing"; failures are ignored (nothing to retry). */
export async function nowPlaying(track: Track): Promise<void> {
  if (!lastfmActive()) return;
  const s = get(settingsStore);
  const f = fieldsFromTrack(track);
  try {
    await invokeStrict('lastfm_now_playing', {
      apiKey: s.lastfmApiKey,
      apiSecret: s.lastfmApiSecret,
      sessionKey: s.lastfmSessionKey,
      artist: f.artist,
      track: f.track,
      album: f.album ?? null,
      duration: f.duration ?? null,
    });
  } catch {
    /* now playing is transient by design */
  }
}

/** Submit one scrobble. Returns false when it should be retried later. */
export async function scrobble(fields: ScrobbleFields, timestampSeconds: number): Promise<boolean> {
  if (!lastfmActive()) return false;
  const s = get(settingsStore);
  try {
    await invokeStrict('lastfm_scrobble', {
      apiKey: s.lastfmApiKey,
      apiSecret: s.lastfmApiSecret,
      sessionKey: s.lastfmSessionKey,
      artist: fields.artist,
      track: fields.track,
      album: fields.album ?? null,
      duration: fields.duration ?? null,
      timestamp: timestampSeconds,
    });
    return true;
  } catch {
    return false;
  }
}
