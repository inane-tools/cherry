// OS actions use Linux MPRIS or Chromium Media Session through the desktop adapter.

import { listen } from '$lib/desktop/event';
import { next, prev, toggle, playerStore, seekTo, setVolume } from './player';
import { setShuffle, setRepeat } from './queue';
import { updateSettings } from './settings';
import type { RepeatMode } from '$lib/core/models';
import { isDesktop } from './platform';
import { get } from 'svelte/store';

let started = false;

export async function startMediaKeyListener(): Promise<void> {
  if (started || !isDesktop()) return;
  started = true;
  const routes: Record<string, () => Promise<void> | void> = {
    'media-key://playpause': () => toggle(),
    'media-key://play': async () => {
      if (get(playerStore).status !== 'playing') await toggle();
    },
    'media-key://pause': async () => {
      if (get(playerStore).status === 'playing') await toggle();
    },
    'media-key://next': () => next(),
    'media-key://prev': () => prev(),
    // Stop must never *start* playback (it used to toggle, so pressing Stop
    // while paused resumed the music).
    'media-key://stop': async () => {
      if (get(playerStore).status === 'playing') await toggle();
    },
  };
  // Register every listener at once: each `listen` is an IPC round trip, and
  // awaiting them one by one serialised startup behind a dozen of them.
  await Promise.all(
    Object.entries(routes).map(([event, handler]) =>
      listen(event, () => void handler()).catch(() => undefined),
    ),
  );

  // Events that carry a payload (the media card's scrubber and volume).
  await Promise.all([
    ...(window.cherryDesktop?.platform === 'linux' ? [
    listen<{ shuffle: boolean }>('media-key://shuffle', (event) => {
      if (typeof event.payload.shuffle !== 'boolean') return;
      setShuffle(event.payload.shuffle);
      void updateSettings({ shuffle: event.payload.shuffle });
    }).catch(() => undefined),
    listen<{ repeat: RepeatMode }>('media-key://repeat', (event) => {
      if (!['off', 'all', 'one'].includes(event.payload.repeat)) return;
      setRepeat(event.payload.repeat);
      void updateSettings({ repeat: event.payload.repeat });
    }).catch(() => undefined),
    ] : []),
    listen<{ positionSecs: number }>('media-key://seek', (event) => {
      seekTo(event.payload.positionSecs);
    }).catch(() => undefined),
    listen<{ deltaSecs: number }>('media-key://seek-by', (event) => {
      const st = get(playerStore);
      seekTo(Math.max(0, st.positionSeconds + event.payload.deltaSecs));
    }).catch(() => undefined),
    listen<{ volume: number }>('media-key://volume', (event) => {
      setVolume(event.payload.volume);
    }).catch(() => undefined),
  ]);
}
