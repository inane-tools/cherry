import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SettingsView from '../../src/lib/ui/views/SettingsView.svelte';
import { settingsStore, updateSettings } from '../../src/lib/app/services/settings';
import { playerStore } from '../../src/lib/app/services/player';
import { DEFAULT_SETTINGS } from '../../src/lib/infra/storage/settingsRepo';

// Build-time constants that Vite defines for the app bundle.
vi.hoisted(() => { Object.assign(globalThis, { __APP_VERSION__: '2.3.0', __CHERRY_BUILD__: 'test — 2026-11-10 00:00:00Z' }); });

vi.mock('$lib/app/services/settings', async () => ({ settingsStore: (await import('svelte/store')).writable({}), updateSettings: vi.fn() }));
vi.mock('$lib/app/services/auth', async () => ({
  authStore: (await import('svelte/store')).writable(null),
  beginYtmLogin: vi.fn(), cancelYtmLogin: vi.fn(), finishYtmLogin: vi.fn(), pollYtmStatus: vi.fn(), signInWithCookie: vi.fn(), signOut: vi.fn(),
}));
vi.mock('$lib/app/services/playlists', async () => {
  const { writable } = await import('svelte/store');
  return { libraryError: writable(null), libraryLoading: writable(false), playlistStore: writable([]), refreshLibrary: vi.fn(), reloadAll: vi.fn() };
});
vi.mock('$lib/app/services/account', async () => {
  const { writable } = await import('svelte/store');
  return { activeChannelStore: writable(null), channelsStore: writable([]), refreshActiveProfile: vi.fn(), selectChannel: vi.fn() };
});
vi.mock('$lib/app/services/theme', () => ({ applyCustomAccent: vi.fn(), previewCustomAccent: vi.fn() }));
vi.mock('$lib/app/services/playlistEdit', () => ({ setDefaultPlaylist: vi.fn() }));
vi.mock('$lib/app/services/addablePlaylists', async () => ({ addablePlaylistsStore: (await import('svelte/store')).writable([]), loadAddablePlaylists: vi.fn() }));
vi.mock('$lib/app/services/lastfm', () => ({ beginAuth: vi.fn(), completeAuth: vi.fn() }));
vi.mock('$lib/app/services/devtools', () => ({ openDevTools: vi.fn(), reloadFrontend: vi.fn(), toggleDeveloperOptions: vi.fn() }));
vi.mock('$lib/app/services/player', async () => ({ playerStore: (await import('svelte/store')).writable({ track: null }), refreshDiscord: vi.fn() }));
vi.mock('$lib/app/services/maintenance', () => ({ clearAllData: vi.fn(), clearCache: vi.fn(), formatCacheSize: vi.fn(async () => '0 B') }));
vi.mock('$lib/ui/components/UpdateSettings.svelte', async () => ({ default: (await import('./stubs/Empty.svelte')).default }));

let target: HTMLElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  vi.mocked(updateSettings).mockClear();
  settingsStore.set({ ...DEFAULT_SETTINGS, theme: 'dark', accentSource: 'song', compactSidebar: false });
  playerStore.set({ track: null } as never);
  target = document.createElement('div');
  document.body.append(target);
  component = mount(SettingsView, { target });
  flushSync();
});
afterEach(() => { unmount(component); target.remove(); });

const radio = (group: string, name: string) =>
  [...target.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`)]
    .find(button => button.textContent?.trim() === name)!;

it('shows theme, accent and sidebar choices as selectable previews', () => {
  expect(radio('Theme', 'Dark').getAttribute('aria-checked')).toBe('true');
  expect(radio('Theme', 'Light').getAttribute('aria-checked')).toBe('false');
  radio('Theme', 'Light').click();
  expect(updateSettings).toHaveBeenCalledWith({ theme: 'light' });

  expect(radio('Accent colour source', 'Song art').getAttribute('aria-checked')).toBe('true');
  radio('Accent colour source', 'Custom').click();
  expect(updateSettings).toHaveBeenCalledWith({ accentSource: 'custom' });

  expect(radio('Sidebar layout', 'Full').getAttribute('aria-checked')).toBe('true');
  radio('Sidebar layout', 'Covers only').click();
  expect(updateSettings).toHaveBeenCalledWith({ compactSidebar: true });
});

it('uses the playing artwork in the song-art preview', () => {
  expect(radio('Accent colour source', 'Song art').querySelector('img')).toBeNull();
  playerStore.set({ track: { videoId: 'v', title: 'Song', artists: [], thumbnails: [{ url: 'https://art/cover.jpg' }] } } as never);
  flushSync();
  expect(radio('Accent colour source', 'Song art').querySelector('img')?.getAttribute('src')).toBe('https://art/cover.jpg');
});

it('lists every section in the chip bar and marks the first as current', () => {
  const chips = [...target.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button')];
  expect(chips.map(chip => chip.textContent?.trim())).toEqual(['Account', 'Appearance', 'Player', 'Integrations', 'Data', 'Shortcuts', 'About']);
  expect(chips[0].getAttribute('aria-current')).toBe('true');
  for (const id of ['account', 'appearance', 'player', 'integrations', 'data', 'shortcuts', 'about']) {
    expect(target.querySelector(`#settings-${id}`), id).not.toBeNull();
  }
});

it('keeps Integrations and Shortcuts collapsed until opened or jumped to', () => {
  const header = (id: string) => target.querySelector<HTMLElement>(`#settings-${id} [role="button"][aria-expanded]`)!;
  expect(header('integrations').getAttribute('aria-expanded')).toBe('false');
  expect(header('shortcuts').getAttribute('aria-expanded')).toBe('false');
  expect(header('player')).toBeNull();

  header('integrations').click(); flushSync();
  expect(header('integrations').getAttribute('aria-expanded')).toBe('true');

  const chip = [...target.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button')]
    .find(button => button.textContent?.trim() === 'Shortcuts')!;
  chip.click(); flushSync();
  expect(header('shortcuts').getAttribute('aria-expanded')).toBe('true');
});
