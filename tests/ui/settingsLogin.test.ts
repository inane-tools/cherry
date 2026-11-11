import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SettingsView from '../../src/lib/ui/views/SettingsView.svelte';
import { settingsStore } from '../../src/lib/app/services/settings';
import { beginYtmLogin, cancelYtmLogin, finishYtmLogin, pollYtmStatus } from '../../src/lib/app/services/auth';
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
vi.mock('$lib/app/services/platform', async (original) => ({ ...(await original<object>()), isDesktop: () => true }));
vi.mock('$lib/ui/components/UpdateSettings.svelte', async () => ({ default: (await import('./stubs/Empty.svelte')).default }));

let target: HTMLElement;
let component: ReturnType<typeof mount>;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(finishYtmLogin).mockClear();
  vi.mocked(beginYtmLogin).mockResolvedValue(undefined as never);
  settingsStore.set({ ...DEFAULT_SETTINGS });
  target = document.createElement('div');
  document.body.append(target);
  component = mount(SettingsView, { target });
  flushSync();
});
afterEach(() => { unmount(component); target.remove(); vi.useRealTimers(); });

const button = (label: string) =>
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;

// Regression: a poll in flight when the user pressed Cancel resolved afterwards,
// overwrote the status line and could even finish the abandoned sign-in.
it('ignores a login poll that resolves after Cancel', async () => {
  let resolvePoll!: (status: { open: boolean; loggedIn: boolean }) => void;
  vi.mocked(pollYtmStatus).mockImplementationOnce(() => new Promise(resolve => (resolvePoll = resolve)) as never);
  button('Sign in with YouTube Music').click();
  await settle();
  expect(button('Cancel')).toBeTruthy();

  button('Cancel').click();
  flushSync();
  expect(cancelYtmLogin).toHaveBeenCalled();
  resolvePoll({ open: true, loggedIn: true });
  await settle();
  expect(finishYtmLogin).not.toHaveBeenCalled();

  // A new attempt starts from a clean status line, not the stale poll's.
  vi.mocked(pollYtmStatus).mockImplementation(() => new Promise(() => {}) as never);
  button('Sign in with YouTube Music').click();
  await settle();
  expect(target.textContent).toContain('Sign in to YouTube Music in the opened window.');
  expect(target.textContent).not.toContain('Account detected');
});
