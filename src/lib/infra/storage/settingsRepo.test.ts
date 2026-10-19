import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake desktop settings file and encrypted credential store, observable by the tests.
const file = new Map<string, unknown>();
const keychain = new Map<string, string>();
let keychainBroken = false;

vi.mock('$lib/app/services/platform', () => ({ isDesktop: () => true }));
vi.mock('$lib/desktop/store', () => ({
  Store: {
    load: async () => ({
      get: async (key: string) => structuredClone(file.get(key)),
      set: async (key: string, value: unknown) => void file.set(key, structuredClone(value)),
      save: async () => undefined,
    }),
  },
}));
vi.mock('$lib/desktop/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { name: string; value?: string }) => {
    if (keychainBroken) throw new Error('no secret service');
    if (cmd === 'secret_load') return keychain.get(args.name) ?? null;
    if (cmd === 'secret_save') {
      if (args.value) keychain.set(args.name, args.value);
      else keychain.delete(args.name);
      return null;
    }
    throw new Error(`unexpected ${cmd}`);
  }),
}));

const repo = await import('./settingsRepo');

beforeEach(() => {
  file.clear();
  keychain.clear();
  keychainBroken = false;
  repo.resetSettingsCache();
});

const stored = () => file.get('settings') as Record<string, unknown>;

describe('settings repository', () => {
  it('restores preferred video quality after unrelated settings changes and a reload', async () => {
    await repo.saveSettings({ videoQuality: '720' });
    await repo.saveSettings({ theme: 'dark' });
    repo.resetSettingsCache();
    const loaded = await repo.loadSettings();
    expect(loaded.videoQuality).toBe('720');
    expect(loaded.theme).toBe('dark');
  });
  it('returns defaults when nothing is stored', async () => {
    expect(await repo.loadSettings()).toEqual(repo.DEFAULT_SETTINGS);
  });

  it('adds recent-playlist defaults to older settings and persists shortcuts', async () => {
    file.set('settings', { volume: 0.4 });
    expect((await repo.loadSettings()).recentPlaylists).toEqual([]);
    const recentPlaylists = [{ browseId: 'VLPIN', title: 'Playlist', thumbnail: '' }];
    await repo.saveSettings({ recentPlaylists });
    repo.resetSettingsCache();
    expect((await repo.loadSettings()).recentPlaylists).toEqual(recentPlaylists);
  });

  it('keeps controls visible for pre-1.5 settings and remembers disabling them', async () => {
    file.set('settings', { volume: 0.4, compactSidebar: true });
    expect((await repo.loadSettings()).windowControls).toBe(true);
    await repo.saveSettings({ windowControls: false });
    repo.resetSettingsCache();
    const restored = await repo.loadSettings();
    expect(restored.windowControls).toBe(false);
    expect(restored.volume).toBe(0.4);
    expect(restored.compactSidebar).toBe(true);
  });

  it('merges patches and never drops an earlier concurrent write', async () => {
    await Promise.all([repo.saveSettings({ volume: 0.3 }), repo.saveSettings({ shuffle: true })]);
    repo.resetSettingsCache();
    const loaded = await repo.loadSettings();
    expect(loaded.volume).toBe(0.3);
    expect(loaded.shuffle).toBe(true);
  });

  it('keeps Last.fm secrets out of the settings file', async () => {
    await repo.saveSettings({ lastfmApiKey: 'key', lastfmApiSecret: 'secret', lastfmSessionKey: 'sk' });
    expect(stored().lastfmApiKey).toBe('key');
    expect(stored()).not.toHaveProperty('lastfmApiSecret');
    expect(stored()).not.toHaveProperty('lastfmSessionKey');
    expect(JSON.parse(keychain.get('lastfm')!)).toEqual({ lastfmApiSecret: 'secret', lastfmSessionKey: 'sk' });

    repo.resetSettingsCache();
    const loaded = await repo.loadSettings();
    expect(loaded.lastfmApiSecret).toBe('secret');
    expect(loaded.lastfmSessionKey).toBe('sk');
  });

  it('moves plaintext secrets written by an older version into the keychain', async () => {
    file.set('settings', { volume: 0.5, lastfmApiSecret: 'old', lastfmSessionKey: 'oldsk' });
    const loaded = await repo.loadSettings();
    expect(loaded.lastfmApiSecret).toBe('old');
    expect(loaded.volume).toBe(0.5);
    expect(stored()).not.toHaveProperty('lastfmApiSecret');
    expect(JSON.parse(keychain.get('lastfm')!).lastfmSessionKey).toBe('oldsk');
  });

  it('leaves plaintext secrets in place if the keychain is unavailable', async () => {
    file.set('settings', { lastfmApiSecret: 'old' });
    keychainBroken = true;
    const loaded = await repo.loadSettings();
    expect(loaded.lastfmApiSecret).toBe('old');
    expect(stored().lastfmApiSecret).toBe('old');
  });

  it('still saves ordinary settings when the keychain write fails', async () => {
    keychainBroken = true;
    await repo.saveSettings({ volume: 0.1, lastfmSessionKey: 'sk' });
    expect(stored().volume).toBe(0.1);
    expect(stored()).not.toHaveProperty('lastfmSessionKey');
  });

  it('clearing the session key deletes the keychain entry', async () => {
    await repo.saveSettings({ lastfmApiSecret: 's', lastfmSessionKey: 'sk' });
    await repo.saveSettings({ lastfmApiSecret: '', lastfmSessionKey: '' });
    expect(keychain.has('lastfm')).toBe(false);
  });
});
