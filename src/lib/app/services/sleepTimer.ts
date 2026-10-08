// Sleep timer: stop the music after a while, or at the end of the current
// track.
//
// Timed mode fades the volume out over the last few seconds and pauses (the
// volume is then put back, so the next play is at the user's level). End-of-
// track mode lets the current song finish and cues the next one paused — see
// `stopAfterTrack` in the player. Nothing here is persisted: a sleep timer that
// survived a restart would stop music the user just started.

import { get, writable } from 'svelte/store';
import { fadeOutAndPause, playerStore, stopAfterTrack } from './player';

export type SleepTimer =
  | { mode: 'off' }
  | { mode: 'time'; endsAt: number; minutes: number }
  | { mode: 'track' };

export const sleepTimerStore = writable<SleepTimer>({ mode: 'off' });

/** Presets offered in the player's sleep-timer menu, in minutes. */
export const SLEEP_PRESETS = [5, 15, 30, 45, 60, 90] as const;

/** Fade length before the pause. */
export const FADE_MS = 8000;

let timer: ReturnType<typeof setTimeout> | null = null;
let fade: AbortController | null = null;

function clearPending(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  fade?.abort();
  fade = null;
  stopAfterTrack.set(false);
}

/** Stop playback `minutes` from now (replaces any running timer). */
export function startSleepTimer(minutes: number, now = Date.now()): void {
  clearPending();
  const ms = Math.max(0, minutes * 60_000);
  const endsAt = now + ms;
  sleepTimerStore.set({ mode: 'time', endsAt, minutes });
  // Start fading so the music reaches silence exactly at `endsAt`.
  timer = setTimeout(() => {
    timer = null;
    void expire();
  }, Math.max(0, ms - FADE_MS));
}

async function expire(): Promise<void> {
  if (get(playerStore).status !== 'playing') {
    sleepTimerStore.set({ mode: 'off' });
    return;
  }
  const controller = new AbortController();
  fade = controller;
  await fadeOutAndPause(FADE_MS, controller.signal);
  if (fade === controller) {
    fade = null;
    sleepTimerStore.set({ mode: 'off' });
  }
}

/** Let the current track finish, then stop (the next track is cued, paused). */
export function sleepAfterTrack(): void {
  clearPending();
  stopAfterTrack.set(true);
  sleepTimerStore.set({ mode: 'track' });
}

export function cancelSleepTimer(): void {
  clearPending();
  sleepTimerStore.set({ mode: 'off' });
}

// The player clears `stopAfterTrack` when it acts on it; mirror that here so the
// timer reads "off" once the track has ended.
stopAfterTrack.subscribe((on) => {
  if (!on && get(sleepTimerStore).mode === 'track') sleepTimerStore.set({ mode: 'off' });
});

/** Whole seconds left on a timed sleep timer (0 when not running). */
export function secondsLeft(state: SleepTimer, now = Date.now()): number {
  return state.mode === 'time' ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
}

/** `m:ss` (or `h:mm:ss`) for the countdown label. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = r.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
