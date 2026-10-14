import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./settings', async () => {
  const { writable, get } = await import('svelte/store');
  const settingsStore = writable({ pinnedPlaylists: [], playlistFolders: [], sidebarOrder: [], collapsedFolders: [] });
  return { settingsStore, updateSettings: async (patch: object) => settingsStore.set({ ...get(settingsStore), ...patch }) };
});
vi.mock('./playlists', async () => ({ playlistStore: (await import('svelte/store')).writable([]) }));
import { settingsStore } from './settings';
import { pinnedStore, reorderPin } from './pins';
import { initFolders, createFolder, movePlaylist, foldersStore } from './folders';
const pins = ['A', 'B', 'C'].map((browseId) => ({ browseId, title: browseId }));
beforeEach(() => {
  settingsStore.set({ ...get(settingsStore), pinnedPlaylists: pins, playlistFolders: [], sidebarOrder: [], collapsedFolders: [] });
  pinnedStore.set(pins);
  initFolders();
});

it('reorders pins within their group and persists the order without unpinning', async () => {
  await reorderPin('C', 'A');
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['C', 'A', 'B']);
  expect(get(settingsStore).pinnedPlaylists).toEqual(get(pinnedStore));
  await reorderPin('C', 'not-a-pin');
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['C', 'A', 'B']);
  await reorderPin('C', null);
  expect(get(pinnedStore).map((pin) => pin.browseId)).toEqual(['A', 'B', 'C']);
});

it('rejects folder moves for pins while allowing unpinned playlists', async () => {
  const folder = (await createFolder('Folder'))!;
  await movePlaylist('A', folder, null);
  expect(get(foldersStore)[0].playlistIds).toEqual([]);
  expect(get(pinnedStore)).toEqual(pins);
  await movePlaylist('unpinned', folder, null);
  expect(get(foldersStore)[0].playlistIds).toEqual(['unpinned']);
});
