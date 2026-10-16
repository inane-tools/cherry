import { get, writable } from 'svelte/store';
import type { Lyrics } from '$lib/core/models';
import { getActiveChannel, getTrackLyrics } from '$lib/infra/ytmusic/InnertubeClient';
import { lookupLyrics } from '$lib/infra/ytmusic/lyricsTiming';
import { playerStore, videoMode } from './player';
import { authStore } from './auth';
import { activeChannelStore } from './account';
import { settingsStore, updateSettings } from './settings';
import { playerExpanded, expandedPlayerPanel } from './layout';

export const lyricsStore = writable<{ status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'; data: Lyrics | null }>({ status: 'idle', data: null });
export function activeLyricAt(lyrics: Lyrics | null, seconds: number): number {
  if (!lyrics?.synced) return -1;
  for (let i = lyrics.lines.length - 1; i >= 0; i--) {
    const line = lyrics.lines[i];
    if (line.startSeconds !== undefined && seconds >= line.startSeconds) {
      return line.endSeconds === undefined || seconds < line.endSeconds ? i : -1;
    }
  }
  return -1;
}
let toggleWrites = Promise.resolve();
export function toggleLyrics(): void {
  if (get(videoMode)) return;
  // Read after the prior save completes, so quick clicks don't both save the
  // same stale value. Visibility changes no longer restart the lyrics lookup.
  toggleWrites = toggleWrites.then(async () => {
    if (!get(videoMode)) await updateSettings({ lyricsEnabled: !get(settingsStore).lyricsEnabled });
  }).catch(() => {});
}
let retry = () => {};
export function retryLyrics(): void { retry(); }
export function startLyrics(): () => void {
  let key = ''; let generation = 0; let cookie = '';
  const cache = new Map<string, Lyrics | null>();
  const providerCache = new Map<string, Lyrics | null>();
  function sync(force = false) {
    const session = get(authStore);
    if (cookie !== (session?.cookie ?? '')) {
      cache.clear(); providerCache.clear(); cookie = session?.cookie ?? ''; key = ''; generation++;
      lyricsStore.set({ status: 'idle', data: null });
    }
    const state = get(playerStore);
    const track = state.track;
    const videoId = track?.videoId;
    const settings = get(settingsStore);
    const duration = state.durationSeconds || track?.durationSeconds || 0;
    const lookup = settings.lyricsLookupEnabled !== false && !state.isLive;
    const watching = !get(videoMode) && (settings.lyricsEnabled || settings.playerShowLyrics !== false
      || (get(playerExpanded) && get(expandedPlayerPanel) === 'lyrics'));
    const next = watching && session && videoId ? `${getActiveChannel()}:${videoId}:${lookup ? Math.round(duration) : 'yt'}` : '';
    if (!force && next === key) return;
    key = next; const id = ++generation;
    if (!next || !session || !videoId) { lyricsStore.set({ status: 'idle', data: null }); return; }
    if (!force && cache.has(next)) {
      const data = cache.get(next)!; lyricsStore.set({ status: data ? 'ready' : 'missing', data }); return;
    }
    lyricsStore.set({ status: 'loading', data: null });
    const load = async () => {
      if (lookup && track) {
        const preferred = await lookupLyrics(track, duration).catch(() => null);
        if (id !== generation) return null;
        if (preferred) return preferred;
      }
      let data: Lyrics | null = null;
      let failure: unknown;
      const providerKey = `${getActiveChannel()}:${videoId}`;
      if (!force && providerCache.has(providerKey)) data = providerCache.get(providerKey)!;
      else {
        try { data = await getTrackLyrics(videoId, session); } catch (error) { failure = error; }
        if (id !== generation) return null;
        if (!failure) {
          providerCache.set(providerKey, data);
          if (providerCache.size > 32) providerCache.delete(providerCache.keys().next().value!);
        }
      }
      if (id !== generation) return null;
      if (!data && failure) throw failure;
      return data;
    };
    void load().then(data => {
      if (id !== generation) return;
      cache.set(next, data);
      if (cache.size > 32) cache.delete(cache.keys().next().value!);
      lyricsStore.set({ status: data ? 'ready' : 'missing', data });
    }).catch(() => { if (id === generation) lyricsStore.set({ status: 'error', data: null }); });
  }
  retry = () => sync(true);
  const stops = [playerStore, authStore, settingsStore, activeChannelStore, videoMode, playerExpanded, expandedPlayerPanel].map(store => store.subscribe(() => sync()));
  return () => { generation++; stops.forEach(stop => stop()); cache.clear(); providerCache.clear(); retry = () => {}; };
}
