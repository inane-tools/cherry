// Pinned playlists for the top bar.
//
// Pins are stored in settings (so they survive restarts) and mirrored in a
// store so the top bar and the playlist rail stay in sync.

import { get, writable } from 'svelte/store';
import type { PinnedPlaylist, Playlist } from '$lib/core/models';
import { bestThumbnail } from '$lib/core/models';
import { settingsStore, updateSettings } from './settings';
import { openPlaylist, playlistStore } from './playlists';

export const pinnedStore = writable<PinnedPlaylist[]>([]);

export function initPins(): void {
  pinnedStore.set(get(settingsStore).pinnedPlaylists ?? []);
}

/**
 * Keep pins fresh. Playlist artwork URLs can expire (and auto-generated
 * playlists change theirs), which is why a pinned playlist that isn't yours
 * would eventually lose its icon — so re-sync title/thumbnail from the loaded
 * library whenever it lands.
 */
export async function syncPins(playlists: Playlist[]): Promise<void> {
  const pins = get(pinnedStore);
  if (pins.length === 0 || playlists.length === 0) return;
  let changed = false;
  const next = pins.map((pin) => {
    const match = playlists.find((p) => p.browseId === pin.browseId);
    if (!match) return pin;
    const thumbnail = bestThumbnail(match.thumbnails, 96) || pin.thumbnail;
    const title = match.title || pin.title;
    if (thumbnail !== pin.thumbnail || title !== pin.title) {
      changed = true;
      return { ...pin, thumbnail, title };
    }
    return pin;
  });
  if (!changed) return;
  pinnedStore.set(next);
  await updateSettings({ pinnedPlaylists: next });
}

// Re-sync as soon as the library loads (or is refreshed).
playlistStore.subscribe((playlists) => {
  if (playlists.length > 0) void syncPins(playlists);
});

export function isPinned(browseId: string): boolean {
  return get(pinnedStore).some((p) => p.browseId === browseId);
}

/** Pin or unpin a playlist, persisting the change. */
export async function togglePin(playlist: Playlist): Promise<void> {
  const current = get(pinnedStore);
  const exists = current.some((p) => p.browseId === playlist.browseId);
  const next: PinnedPlaylist[] = exists
    ? current.filter((p) => p.browseId !== playlist.browseId)
    : [
        ...current,
        {
          browseId: playlist.browseId,
          title: playlist.title,
          thumbnail: bestThumbnail(playlist.thumbnails, 96) || undefined,
        },
      ].slice(0, 8); // keep the top bar from overflowing
  pinnedStore.set(next);
  await updateSettings({ pinnedPlaylists: next });
}

/** Open a pinned playlist from the top bar. */
export function openPinned(pin: PinnedPlaylist): void {
  const playlist: Playlist = {
    browseId: pin.browseId,
    title: pin.title,
    thumbnails: pin.thumbnail ? [{ url: pin.thumbnail }] : [],
  };
  void openPlaylist(playlist);
}
