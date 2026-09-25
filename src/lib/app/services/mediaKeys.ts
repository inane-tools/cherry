// Listens for OS media events forwarded by the Rust backend (SMTC on Windows:
// the taskbar preview and the Action Center media card, plus hardware media
// keys) and routes them to the player. Also registers app-level global
// shortcuts as fallback.

import { listen } from '@tauri-apps/api/event';
import { next, prev, toggle, playerStore, seekTo, setVolume } from './player';
import { isTauri } from './platform';
import { get } from 'svelte/store';

let started = false;

export async function startMediaKeyListener(): Promise<void> {
  if (started || !isTauri()) return;
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
    'media-key://stop': () => toggle(),
  };
  for (const [event, handler] of Object.entries(routes)) {
    try {
      await listen(event, () => void handler());
    } catch {
      /* plugin/event unavailable — ignore */
    }
  }

  // Events that carry a payload (the media card's scrubber and volume).
  try {
    await listen<{ positionSecs: number }>('media-key://seek', (event) => {
      seekTo(event.payload.positionSecs);
    });
  } catch {
    /* ignore */
  }
  try {
    await listen<{ deltaSecs: number }>('media-key://seek-by', (event) => {
      const st = get(playerStore);
      seekTo(Math.max(0, st.positionSeconds + event.payload.deltaSecs));
    });
  } catch {
    /* ignore */
  }
  try {
    await listen<{ volume: number }>('media-key://volume', (event) => {
      setVolume(event.payload.volume);
    });
  } catch {
    /* ignore */
  }
}
