import { expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Sidebar from '../../src/lib/ui/chrome/Sidebar.svelte';
import { settingsStore } from '../../src/lib/app/services/settings';
import { pinnedStore } from '../../src/lib/app/services/pins';
import { openSidebarPin } from '../../src/lib/app/services/pinActions';
import { settingsOpen } from '../../src/lib/app/services/overlays';
import { DEFAULT_SETTINGS } from '../../src/lib/infra/storage/settingsRepo';
import type { SidebarPin } from '../../src/lib/core/models';

vi.mock('$lib/app/services/settings', async () => ({ settingsStore: (await import('svelte/store')).writable({}), updateSettings: vi.fn() }));
vi.mock('$lib/app/services/pins', async () => ({ pinnedStore: (await import('svelte/store')).writable([]), reorderPin: vi.fn() }));
vi.mock('$lib/app/services/pinActions', () => ({ openSidebarPin: vi.fn() }));
vi.mock('$lib/app/services/playlists', async () => {
  const { writable } = await import('svelte/store');
  return { homeSectionsStore: writable([]), playlistStore: writable([]), libraryLoading: writable(false), libraryError: writable(null), openPlaylist: vi.fn(), refreshLibrary: vi.fn(), refreshPlaylistArtwork: vi.fn() };
});
vi.mock('$lib/app/services/auth', async () => ({ authStore: (await import('svelte/store')).writable({ cookie: 'SID=fixture' }) }));
vi.mock('$lib/app/services/navigation', async () => ({ pageStore: (await import('svelte/store')).writable({ view: 'home' }), go: vi.fn() }));
vi.mock('$lib/app/services/overlays', async () => ({ settingsOpen: (await import('svelte/store')).writable(false), searchOpen: (await import('svelte/store')).writable(false), openSearch: vi.fn() }));
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

it.each([[false, false], [true, false], [true, true]])('shows mixed pins and icon navigation (compact: %s, drawer: %s)', async (compact, forceFull) => {
  const pins: SidebarPin[] = [
    { kind: 'album', browseId: 'MPRalbum', title: 'Album', album: { browseId: 'MPRalbum', title: 'Album', artists: [], thumbnails: [] } },
    { kind: 'artist', browseId: 'UCartist', title: 'Artist', artist: { browseId: 'UCartist', name: 'Artist' } },
    { kind: 'song', browseId: 'song:video', title: 'Song', track: { videoId: 'video', title: 'Song', artists: [], thumbnails: [] } },
  ];
  settingsStore.set({ ...DEFAULT_SETTINGS, compactSidebar: compact }); pinnedStore.set(pins);
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(Sidebar, { target, props: { forceFull } });
  try {
    await tick();
    const nav = target.querySelector('nav[aria-label="Main navigation"]')!;
    expect(nav.textContent?.trim()).toBe('');
    expect(nav.classList.contains('flex-col')).toBe(compact && !forceFull);
    expect(nav.classList.contains('flex-row')).toBe(!compact || forceFull);
    // The account sits at the bottom in every layout: a tile in the compact
    // rail, a row with details (and its caret) in the full layout and drawer.
    const account = target.querySelector('[aria-label="Account"]')!;
    expect(account.querySelector('button[aria-label="Main menu"]')).not.toBeNull();
    expect(!!account.querySelector('.ph-caret-up')).toBe(!compact || forceFull);
    const create = target.querySelector('[aria-label="New playlist or folder"]')!;
    expect(!!create.closest('[aria-label="Playlists and folders"]')).toBe(true);
    expect(nav.contains(create)).toBe(false);
    expect(target.querySelectorAll('[aria-label="New playlist or folder"]')).toHaveLength(1);
    expect(Array.from(target.querySelectorAll('button[aria-label="Search"], button[aria-label="Home"], button[aria-label="Explore"]')).map(button => button.getAttribute('aria-label'))).toEqual(['Search', 'Home', 'Explore']);
    expect(Array.from(target.querySelectorAll<HTMLElement>('[data-top-id]')).map(row => row.dataset.topId)).toEqual(pins.map(pin => pin.browseId));
    expect(target.textContent).not.toContain('No playlists loaded');
    for (const pin of pins) {
      target.querySelector<HTMLButtonElement>(compact && !forceFull ? `button[aria-label="${pin.title}"]` : `button[title="${pin.title}"]`)!.click();
      expect(openSidebarPin).toHaveBeenLastCalledWith(pin);
    }
  } finally { await unmount(component); target.remove(); }
});

it('updates fades for overflow, scrolling, resizing and content changes, with New inside the scroll area', async () => {
  const observed: Array<{ callback: ResizeObserverCallback; nodes: Element[] }> = [];
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    private record: typeof observed[number];
    constructor(callback: ResizeObserverCallback) { this.record = { callback, nodes: [] }; observed.push(this.record); }
    observe(node: Element) { this.record.nodes.push(node); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  settingsStore.set({ ...DEFAULT_SETTINGS, compactSidebar: true }); pinnedStore.set([]);
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(Sidebar, { target });
  try {
    await tick();
    const viewport = target.querySelector<HTMLElement>('[aria-label="Playlists and folders"]')!;
    let height = 200, content = 180;
    Object.defineProperties(viewport, { clientHeight: { get: () => height }, scrollHeight: { get: () => content } });
    const observer = observed.find(record => record.nodes.includes(viewport) && record.nodes.includes(viewport.firstElementChild!))!;
    const resize = async () => { observer.callback([], {} as ResizeObserver); await tick(); };
    const visible = (edge: string) => target.querySelector(`[data-library-fade="${edge}"]`)!.classList.contains('opacity-100');
    expect(viewport.contains(target.querySelector('[aria-label="New playlist or folder"]'))).toBe(true);
    await resize(); expect(visible('top')).toBe(false); expect(visible('bottom')).toBe(false);
    content = 500; await resize(); expect(visible('top')).toBe(false); expect(visible('bottom')).toBe(true);
    viewport.scrollTop = 100; viewport.dispatchEvent(new Event('scroll')); await tick();
    expect(visible('top')).toBe(true); expect(visible('bottom')).toBe(true);
    viewport.scrollTop = 300; viewport.dispatchEvent(new Event('scroll')); await tick();
    expect(visible('top')).toBe(true); expect(visible('bottom')).toBe(false);
    height = 600; await resize(); expect(visible('top')).toBe(false); expect(visible('bottom')).toBe(false);
    height = 0; await resize(); expect(visible('top')).toBe(false); expect(visible('bottom')).toBe(false);
  } finally { await unmount(component); target.remove(); globalThis.ResizeObserver = originalObserver; }
});

it('keeps a navigation row at minimum width and disables resizing while Settings is open', async () => {
  settingsStore.set({ ...DEFAULT_SETTINGS, compactSidebar: false, sidebarWidth: 176 });
  settingsOpen.set(false); pinnedStore.set([]);
  const target = document.createElement('div'); document.body.append(target);
  const component = mount(Sidebar, { target });
  try {
    await tick();
    const nav = target.querySelector('nav')!;
    expect(nav.classList.contains('flex-row')).toBe(true);
    expect(nav.querySelectorAll('button')).toHaveLength(3);
    const handle = target.querySelector<HTMLElement>('[aria-label="Resize sidebar"]')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 176 }));
    settingsOpen.set(true); await tick();
    expect(target.querySelector('[aria-label="Resize sidebar"]')).toBeNull();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 })); await tick();
    expect(target.querySelector('aside')!.style.width).toBe('176px');
    settingsOpen.set(false); await tick();
    expect(target.querySelector('[aria-label="Resize sidebar"]')).not.toBeNull();
    settingsStore.update(s => ({ ...s, sidebarWidth: 240 })); await tick();
    expect(nav.classList.contains('flex-row')).toBe(true);
  } finally { await unmount(component); target.remove(); settingsOpen.set(false); }
});
