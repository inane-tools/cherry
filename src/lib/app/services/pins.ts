// Persistent sidebar pins. Playlist pins from earlier versions remain valid.

import { get, writable } from 'svelte/store';
import type { Album, ArtistRef, SidebarPin, Playlist, Track } from '$lib/core/models';
import { bestThumbnail, isPlaylistPin } from '$lib/core/models';
import { settingsStore, updateSettings } from './settings';
import { playlistStore } from './playlists';
import { getActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { activeChannelStore } from './channelProfile';

export const pinnedStore = writable<SidebarPin[]>([]);
let channels: Record<string, SidebarPin[]> = {};
let currentChannel: string | null = null;
let stopChannel: (() => void) | undefined;
let writes = Promise.resolve();
const channelKey = (id: string) => `channel:${id || 'personal'}`;

export function initPins(): void {
  stopChannel?.();
  const settings = get(settingsStore);
  channels = { ...(settings.pinnedPlaylistsByChannel ?? {}) };
  currentChannel = channelKey(settings.channelPageId);
  // Claim old, unscoped pins only once, for the previously selected channel.
  const migrating = !Object.keys(channels).length && settings.pinnedPlaylists?.length > 0;
  if (migrating) channels[currentChannel] = settings.pinnedPlaylists;
  pinnedStore.set(channels[currentChannel] ?? []);
  stopChannel = activeChannelStore.subscribe(profile => {
    const next = profile ? channelKey(profile.pageId ?? '') : null;
    if (next === currentChannel) return;
    currentChannel = next;
    pinnedStore.set(next ? channels[next] ?? [] : []);
  });
  if (migrating) void savePins().catch(error => console.warn('[cherry] Could not save channel pins:', error));
}

function persistPins(next: SidebarPin[]): Promise<void> {
  if (!currentChannel) return Promise.resolve();
  channels[currentChannel] = next;
  pinnedStore.set(next);
  return savePins();
}

function savePins(): Promise<void> {
  // Serialize snapshots so quick edits followed by an account switch cannot
  // overwrite another channel's pins with an older copy of the map.
  const run = writes.catch(() => {}).then(() => updateSettings({
    pinnedPlaylists: currentChannel ? channels[currentChannel] ?? [] : [],
    pinnedPlaylistsByChannel: { ...channels },
  }));
  writes = run;
  return run;
}

export async function removePin(browseId: string): Promise<void> {
  await persistPins(get(pinnedStore).filter(pin => pin.browseId !== browseId));
}

/**
 * Keep pins fresh. Playlist artwork URLs can expire (and auto-generated
 * playlists change theirs), so re-sync title/thumbnail from the loaded library
 * whenever it lands.
 */
export async function syncPins(playlists: Playlist[]): Promise<void> {
  if (currentChannel !== channelKey(getActiveChannel())) return;
  const pins = get(pinnedStore);
  if (pins.length === 0 || playlists.length === 0) return;
  let changed = false;
  const next = pins.map((pin) => {
    if (!isPlaylistPin(pin)) return pin;
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
  await persistPins(next);
}

// Re-sync as soon as the library loads (or is refreshed).
playlistStore.subscribe((playlists) => {
  if (playlists.length > 0) void syncPins(playlists);
});

export function isPinned(browseId: string): boolean {
  return get(pinnedStore).some((p) => p.browseId === browseId);
}

/** Reorder within the pin group; this never unpins or moves into a folder. */
export async function reorderPin(browseId: string, beforeId: string | null): Promise<void> {
  const current = get(pinnedStore);
  const pin = current.find((item) => item.browseId === browseId);
  if (!pin || beforeId === browseId || (beforeId !== null && !current.some((item) => item.browseId === beforeId))) return;
  const next = current.filter((item) => item.browseId !== browseId);
  const at = beforeId === null ? next.length : next.findIndex((item) => item.browseId === beforeId);
  next.splice(at, 0, pin);
  await persistPins(next);
}

/** Pin or unpin a playlist, persisting the change. */
async function toggleSidebarPin(pin: SidebarPin): Promise<void> {
  const current = get(pinnedStore);
  const exists = current.some((p) => p.browseId === pin.browseId);
  const next = exists ? current.filter((p) => p.browseId !== pin.browseId) : [...current, pin];
  await persistPins(next);
}

export function togglePin(playlist: Playlist): Promise<void> {
  return toggleSidebarPin({ browseId: playlist.browseId, title: playlist.title, thumbnail: bestThumbnail(playlist.thumbnails, 96) || undefined });
}
export function toggleAlbumPin(album: Album): Promise<void> {
  return toggleSidebarPin({ kind: 'album', browseId: album.browseId, title: album.title, thumbnail: bestThumbnail(album.thumbnails, 96) || undefined, album });
}
export function toggleArtistPin(artist: ArtistRef): Promise<void> {
  if (!artist.browseId) return Promise.resolve();
  return toggleSidebarPin({ kind: 'artist', browseId: artist.browseId, title: artist.name, thumbnail: bestThumbnail(artist.thumbnails ?? [], 96) || undefined, artist });
}
export function toggleTrackPin(track: Track): Promise<void> {
  if (!track.videoId) return Promise.resolve();
  const { playlistEntryId: _entry, ...song } = track;
  return toggleSidebarPin({ kind: 'song', browseId: `song:${track.videoId}`, title: track.title, thumbnail: bestThumbnail(track.thumbnails, 96) || undefined, track: song });
}
