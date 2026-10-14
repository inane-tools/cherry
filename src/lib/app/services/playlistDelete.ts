import { get, writable } from 'svelte/store';
import type { AuthSession, Playlist } from '$lib/core/models';
import { deleteOwnedPlaylist, getActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { cacheClear } from '$lib/infra/storage/cache';
import { authStore } from './auth';
import { addablePlaylistsStore } from './addablePlaylists';
import { playlistStore, homeSectionsStore } from './playlists';
import { isPlaylistOwned } from './playlistLibrary';
import { pinnedStore } from './pins';
import { initFolders } from './folders';
import { settingsStore, updateSettings } from './settings';
import { forgetPlaylistPage } from './navigation';
import { notify } from './contextMenu';
import { errorMessage } from './platform';

export const playlistDeleteStore = writable<{ playlist: Playlist | null; busy: boolean; error: string }>({ playlist: null, busy: false, error: '' });
let session: AuthSession | null = null;
let channel = '';

export function requestPlaylistDeletion(playlist: Playlist): void {
  if (get(playlistDeleteStore).busy) return;
  const current = get(authStore);
  if (!current || !isPlaylistOwned(playlist.browseId)) {
    notify('You can only delete a playlist you own.');
    return;
  }
  session = current;
  channel = getActiveChannel();
  playlistDeleteStore.set({ playlist, busy: false, error: '' });
}

export function cancelPlaylistDeletion(): void {
  if (get(playlistDeleteStore).busy) return;
  session = null;
  playlistDeleteStore.set({ playlist: null, busy: false, error: '' });
}

/** Called only by the explicit destructive confirmation button. */
export async function confirmPlaylistDeletion(): Promise<boolean> {
  const { playlist, busy } = get(playlistDeleteStore);
  if (!playlist || busy || !session) return false;
  const sameAccount = () => get(authStore)?.cookie === session?.cookie && getActiveChannel() === channel;
  if (!sameAccount() || !isPlaylistOwned(playlist.browseId)) {
    playlistDeleteStore.update((state) => ({ ...state, error: 'Your account or playlist permissions changed. Cancel and try again.' }));
    return false;
  }
  playlistDeleteStore.update((state) => ({ ...state, busy: true, error: '' }));
  try {
    await deleteOwnedPlaylist(playlist.browseId, session);
    for (const prefix of ['library', 'addable', 'home', 'collection', 'meta']) cacheClear(`${prefix}:${channel}:`);
    if (sameAccount()) {
      playlistStore.update((list) => list.filter((p) => p.browseId !== playlist.browseId));
      addablePlaylistsStore.update((list) => list.filter((p) => p.browseId !== playlist.browseId));
      homeSectionsStore.update((sections) => sections.map((section) => ({ ...section, cards: section.cards.filter((card) => card.browseId !== playlist.browseId), order: section.order?.filter((key) => key !== `c:${playlist.browseId}`) })).filter((section) => section.cards.length || section.songs.length));
      const settings = get(settingsStore);
      const pinnedPlaylists = settings.pinnedPlaylists.filter((p) => p.browseId !== playlist.browseId);
      await updateSettings({
        pinnedPlaylists,
        recentPlaylists: settings.recentPlaylists.filter((p) => p.browseId !== playlist.browseId),
        playlistFolders: settings.playlistFolders.map((folder) => ({ ...folder, playlistIds: folder.playlistIds.filter((id) => id !== playlist.browseId) })),
        sidebarOrder: settings.sidebarOrder.filter((id) => id !== playlist.browseId),
        ...(settings.defaultPlaylistBrowseId === playlist.browseId ? { defaultPlaylistBrowseId: '' } : {}),
      });
      pinnedStore.set(pinnedPlaylists);
      initFolders();
      forgetPlaylistPage(playlist.browseId);
      notify(`Deleted “${playlist.title}”`);
    }
    session = null;
    playlistDeleteStore.set({ playlist: null, busy: false, error: '' });
    return true;
  } catch (error) {
    playlistDeleteStore.update((state) => ({ ...state, busy: false, error: errorMessage(error, 'Could not delete the playlist. Try again.') }));
    return false;
  }
}
