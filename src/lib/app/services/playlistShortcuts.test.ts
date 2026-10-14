import { expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('./settings', async () => {
  const { writable, get } = await import('svelte/store');
  const settingsStore = writable({ recentPlaylists: [] });
  return { settingsStore, updateSettings: async (patch: object) => {
    await Promise.resolve();
    settingsStore.set({ ...get(settingsStore), ...patch });
  } };
});
import { rememberPlaylist } from './playlistShortcuts';
import { settingsStore } from './settings';

it('keeps rapid selections in order, limits recents, and moves revisits to the top', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => rememberPlaylist({ browseId: `VL${i}`, title: `Playlist ${i}`, thumbnails: [] })));
  expect(get(settingsStore).recentPlaylists.map((p) => p.browseId)).toEqual(['VL9', 'VL8', 'VL7', 'VL6', 'VL5', 'VL4', 'VL3', 'VL2']);
  await rememberPlaylist({ browseId: 'VL5', title: 'Renamed playlist', thumbnails: [] });
  expect(get(settingsStore).recentPlaylists[0]).toMatchObject({ browseId: 'VL5', title: 'Renamed playlist' });
  expect(get(settingsStore).recentPlaylists.filter((p) => p.browseId === 'VL5')).toHaveLength(1);
});
