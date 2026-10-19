import { expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Sidebar from '../../src/lib/ui/chrome/Sidebar.svelte';
import { settingsStore } from '../../src/lib/app/services/settings';
import { pinnedStore } from '../../src/lib/app/services/pins';
import { openSidebarPin } from '../../src/lib/app/services/pinActions';
import { DEFAULT_SETTINGS } from '../../src/lib/infra/storage/settingsRepo';
import type { SidebarPin } from '../../src/lib/core/models';

vi.mock('$lib/app/services/settings', async () => ({ settingsStore: (await import('svelte/store')).writable({}), updateSettings: vi.fn() }));
vi.mock('$lib/app/services/pins', async () => ({ pinnedStore: (await import('svelte/store')).writable([]), reorderPin: vi.fn() }));
vi.mock('$lib/app/services/pinActions', () => ({ openSidebarPin: vi.fn() }));
vi.mock('$lib/app/services/playlists', async () => {
  const { writable } = await import('svelte/store');
  return { playlistStore: writable([]), libraryLoading: writable(false), libraryError: writable(null), openPlaylist: vi.fn(), refreshLibrary: vi.fn(), refreshPlaylistArtwork: vi.fn() };
});
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ cookie: 'SID=fixture' }) }));
vi.mock('$lib/app/services/navigation', async () => ({ pageStore: (await import('svelte/store')).writable({ view: 'home' }), go: vi.fn() }));
vi.mock('$lib/app/services/overlays', async () => ({ searchOpen: (await import('svelte/store')).writable(false), openSearch: vi.fn() }));
vi.mock('$lib/app/services/contextMenu', () => ({ openContextMenu: vi.fn() }));
vi.mock('$lib/app/services/menus', () => ({ playlistMenu: vi.fn(() => []), albumMenu: vi.fn(() => []), artistMenu: vi.fn(() => []), trackMenu: vi.fn(() => []), folderMenu: vi.fn(() => []) }));
vi.mock('$lib/app/services/playlistPicker', () => ({ openPlaylistPicker: vi.fn() }));
vi.mock('$lib/app/services/addablePlaylists', () => ({ loadAddablePlaylists: vi.fn() }));
vi.mock('$lib/app/services/folderDialog', () => ({ openFolderDialog: vi.fn() }));
vi.mock('$lib/app/services/layout', () => ({ closeSidebarDrawer: vi.fn() }));
vi.mock('$lib/app/services/folders', async () => {
  const { writable } = await import('svelte/store');
  return { collapsedFolders: writable(new Set()), foldersStore: writable([]), sidebarOrderStore: writable([]), movePlaylist: vi.fn(), movePlaylistToFolder: vi.fn(), reorderFolder: vi.fn(), toggleFolder: vi.fn() };
});

it.each([false, true])('shows mixed pins with an empty playlist library (compact: %s)', async compact => {
  const pins: SidebarPin[] = [
    { kind: 'album', browseId: 'MPRalbum', title: 'Album', album: { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] } },
    { kind: 'artist', browseId: 'UCartist', title: 'Artist', artist: { browseId: 'UCartist', name: 'Artist' } },
    { kind: 'song', browseId: 'song:video', title: 'Song', track: { videoId: 'video', title: 'Song', artists: [], thumbnails: [] } },
  ];
  settingsStore.set({ ...DEFAULT_SETTINGS, compactSidebar: compact }); pinnedStore.set(pins);
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(Sidebar, { target });
  try {
    await tick();
    expect(Array.from(target.querySelectorAll('button[aria-label="Search"], button[aria-label="Home"], button[aria-label="Explore"]')).map(button => button.getAttribute('aria-label'))).toEqual(['Search', 'Home', 'Explore']);
    expect(Array.from(target.querySelectorAll<HTMLElement>('[data-top-id]')).map(row => row.dataset.topId)).toEqual(pins.map(pin => pin.browseId));
    expect(target.textContent).not.toContain('No playlists loaded');
    for (const pin of pins) {
      target.querySelector<HTMLButtonElement>(compact ? `button[aria-label="${pin.title}"]` : `button[title="${pin.title}"]`)!.click();
      expect(openSidebarPin).toHaveBeenLastCalledWith(pin);
    }
  } finally { await unmount(component); target.remove(); }
});
