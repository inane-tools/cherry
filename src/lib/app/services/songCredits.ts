// Song credits: dialog state plus the fetch that backs it.
//
// Credits are only available for some songs and require a second request, so
// the look-up is deferred until the user actually opens the dialog.

import { get, writable } from 'svelte/store';
import type { Track } from '$lib/core/models';
import { getSongCredits, type CreditSection } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';

export interface CreditsState {
  open: boolean;
  track: Track | null;
  loading: boolean;
  sections: CreditSection[];
  /** Loaded, but the song has no credits. */
  empty: boolean;
  error: string;
}

const CLOSED: CreditsState = {
  open: false,
  track: null,
  loading: false,
  sections: [],
  empty: false,
  error: '',
};

export const songCreditsStore = writable<CreditsState>(CLOSED);

export async function openSongCredits(track: Track): Promise<void> {
  songCreditsStore.set({ ...CLOSED, open: true, track, loading: true });
  try {
    const sections = await getSongCredits(track.videoId, track.creditsBrowseId, get(authStore));
    songCreditsStore.update((s) =>
      s.track?.videoId !== track.videoId
        ? s
        : {
            ...s,
            loading: false,
            sections: sections ?? [],
            empty: !sections || sections.length === 0,
          },
    );
  } catch (e) {
    songCreditsStore.update((s) => ({
      ...s,
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    }));
  }
}

export function closeSongCredits(): void {
  songCreditsStore.update((s) => ({ ...s, open: false }));
}
