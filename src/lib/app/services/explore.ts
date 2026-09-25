// The YouTube Music "Explore" page (moods & genres, new releases, charts).

import { get, writable } from 'svelte/store';
import { getExploreSections } from '$lib/infra/ytmusic/InnertubeClient';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import { authStore } from './auth';

export const exploreSectionsStore = writable<HomeSection[]>([]);
export const exploreLoading = writable(false);
export const exploreLoaded = writable(false);

let inflight: Promise<void> | null = null;

export function loadExplore(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    exploreLoading.set(true);
    try {
      exploreSectionsStore.set(await getExploreSections(get(authStore)));
      exploreLoaded.set(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[cherry] explore feed failed:', e);
      exploreSectionsStore.set([]);
    } finally {
      exploreLoading.set(false);
      inflight = null;
    }
  })();
  return inflight;
}
