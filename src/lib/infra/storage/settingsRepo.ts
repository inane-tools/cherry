// Settings persistence: tauri-plugin-store on desktop, localStorage in browser.
// Auth cookies/visitor-data are sensitive → they go to the OS keychain via
// Rust commands (`auth_save`/`auth_load`/`auth_clear`), never here.
//
// The Last.fm API secret and session key are part of `CherrySettings` (the UI
// treats them like any other setting) but are **never written to the store**:
// on desktop `SECRET_KEYS` are split out and kept in the OS keychain through the
// `secret_save`/`secret_load` commands. Older versions wrote them in plaintext;
// `loadSettings` moves any it finds into the keychain and rewrites the store.

import { Store } from '@tauri-apps/plugin-store';
import { isTauri } from '$lib/app/services/platform';
import type { PinnedPlaylist, PlaylistFolder } from '$lib/core/models';

export interface CherrySettings {
  volume: number;
  muted: boolean;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  discordEnabled: boolean;
  /** Discord application id, set at runtime in Settings. Empty = disabled. */
  discordAppId: string;
  /** Which line Discord shows next to your name: song title / artists / app. */
  discordStatusDisplay: 'details' | 'state' | 'name';
  /** Brand-channel page id whose YouTube Music library to use. */
  channelPageId: string;
  /** Playlists pinned to the top bar. */
  pinnedPlaylists: PinnedPlaylist[];
  /** Playlists grouped into folders in the sidebar. */
  playlistFolders: PlaylistFolder[];
  /**
   * Order of the sidebar's top-level entries — playlist ids and folder ids
   * mixed in one user-organised list. Items not present here are appended in
   * library order, so new playlists still show up.
   */
  sidebarOrder: string[];
  /** Ids of sidebar folders the user collapsed (folders default to open). */
  collapsedFolders: string[];
  /** Slim the playlist rail (covers only, search as a button). */
  compactSidebar: boolean;
  /** Width of the expanded sidebar in pixels (user-resizable by dragging). */
  sidebarWidth: number;
  /** Show the accent gradient washes (content background + player bar). */
  gradientsEnabled: boolean;
  minimizeToTray: boolean;
  /** Appearance: follow the OS, or force light/dark. */
  theme: 'system' | 'light' | 'dark';
  /** Accent colour: follow the album art, or a fixed custom colour. */
  accentSource: 'song' | 'custom';
  /** Custom accent (hex), used when `accentSource === 'custom'`. */
  accentColor: string;
  /** UI zoom level applied to the whole window (1 = 100%). */
  uiZoom: number;
  /** Playlist that "Add to playlist" saves to without asking. Empty = ask. */
  defaultPlaylistBrowseId: string;
  defaultPlaylistTitle: string;
  /** Reveal the Developer section's DevTools access (off by default). */
  devToolsEnabled: boolean;
  /** Last.fm scrobbling; the session key/username come from the auth flow. */
  lastfmEnabled: boolean;
  lastfmApiKey: string;
  lastfmApiSecret: string;
  lastfmSessionKey: string;
  lastfmUsername: string;
  /** Send "now playing" updates while a track plays. */
  lastfmNowPlaying: boolean;
  /** Percent of a track that must play before scrobbling (Last.fm default 50). */
  lastfmScrobblePercent: number;
  /** Tracks shorter than this many seconds are never scrobbled. */
  lastfmMinDurationSeconds: number;
}

export const DEFAULT_SETTINGS: CherrySettings = {
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
  discordEnabled: true,
  discordAppId: '',
  discordStatusDisplay: 'details',
  channelPageId: '',
  pinnedPlaylists: [],
  playlistFolders: [],
  sidebarOrder: [],
  collapsedFolders: [],
  compactSidebar: false,
  sidebarWidth: 240,
  gradientsEnabled: true,
  minimizeToTray: true,
  theme: 'system',
  accentSource: 'song',
  accentColor: '#ff4d5e',
  uiZoom: 1,
  defaultPlaylistBrowseId: '',
  defaultPlaylistTitle: '',
  devToolsEnabled: false,
  lastfmEnabled: false,
  lastfmApiKey: '',
  lastfmApiSecret: '',
  lastfmSessionKey: '',
  lastfmUsername: '',
  lastfmNowPlaying: true,
  lastfmScrobblePercent: 50,
  lastfmMinDurationSeconds: 30,
};

/** Settings that live in the OS keychain instead of the settings file. */
export const SECRET_KEYS = ['lastfmApiSecret', 'lastfmSessionKey'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];
type Secrets = Pick<CherrySettings, SecretKey>;
/** Keychain entry name (see `secrets.rs`). */
const SECRET_NAME = 'lastfm';

const STORE_PATH = 'cherry-settings.json';
const LS_KEY = 'cherry.settings.v1';

let store: Store | null = null;

/**
 * Last known settings, kept in memory so `saveSettings` can merge a patch
 * against the current state instead of re-reading the store each call. Without
 * this, two overlapping writes both read the same base and the later one
 * silently dropped the earlier patch (e.g. a folder reorder racing a collapse
 * toggle).
 */
let cached: CherrySettings | null = null;

/**
 * Writes are serialised through this chain so concurrent `updateSettings` calls
 * cannot interleave their read-modify-write steps.
 */
let writeChain: Promise<unknown> = Promise.resolve();

/** The settings minus the keychain-held secrets. */
export function withoutSecrets(settings: Partial<CherrySettings>): Partial<CherrySettings> {
  const copy: Partial<CherrySettings> = { ...settings };
  for (const key of SECRET_KEYS) delete copy[key];
  return copy;
}

function pickSecrets(settings: Partial<CherrySettings>): Secrets {
  return {
    lastfmApiSecret: settings.lastfmApiSecret ?? '',
    lastfmSessionKey: settings.lastfmSessionKey ?? '',
  };
}

function hasSecrets(secrets: Secrets): boolean {
  return SECRET_KEYS.some((key) => secrets[key]);
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function loadSecrets(): Promise<Secrets | null> {
  try {
    const raw = await invoke<string | null>('secret_load', { name: SECRET_NAME });
    return raw ? pickSecrets(JSON.parse(raw) as Partial<CherrySettings>) : null;
  } catch {
    return null;
  }
}

/** Last value written to the keychain, so unrelated saves don't rewrite it. */
let savedSecrets = '';

async function saveSecrets(secrets: Secrets): Promise<void> {
  const value = hasSecrets(secrets) ? JSON.stringify(secrets) : '';
  if (value === savedSecrets) return;
  await invoke('secret_save', { name: SECRET_NAME, value });
  savedSecrets = value;
}

async function getStore(): Promise<Store | null> {
  if (!isTauri()) return null;
  if (!store) store = await Store.load(STORE_PATH);
  return store;
}

export async function loadSettings(): Promise<CherrySettings> {
  let loaded: CherrySettings | null = null;
  try {
    const s = await getStore();
    if (s) {
      const raw = (await s.get<Partial<CherrySettings>>('settings')) ?? {};
      const legacy = pickSecrets(raw);
      const stored = await loadSecrets();
      const secrets = stored ?? legacy;
      savedSecrets = stored ? JSON.stringify(stored) : '';
      if (hasSecrets(legacy)) {
        // Written in plaintext by an older version: move them to the keychain
        // first, and only then drop them from the file (a failed keychain write
        // must not lose the user's Last.fm login).
        try {
          await saveSecrets(secrets);
          await s.set('settings', withoutSecrets(raw));
          await s.save();
        } catch (e) {
          console.warn('[cherry] could not move Last.fm secrets to the keychain:', e);
        }
      }
      loaded = { ...DEFAULT_SETTINGS, ...withoutSecrets(raw), ...secrets };
    }
  } catch {
    // fall through to localStorage
  }
  if (!loaded) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
  }
  const result = loaded ?? { ...DEFAULT_SETTINGS };
  cached = result;
  return result;
}

export function saveSettings(patch: Partial<CherrySettings>): Promise<CherrySettings> {
  const task = writeChain.then(async () => {
    const current = cached ?? (await loadSettings());
    const next = { ...current, ...patch };
    cached = next;
    try {
      const s = await getStore();
      if (s) {
        // A keychain failure (e.g. no Secret Service on a Linux desktop) must
        // not lose the rest of the settings; the secrets then only last for
        // this run, which is the same rule the YouTube session follows.
        await saveSecrets(pickSecrets(next)).catch((e) =>
          console.warn('[cherry] could not store Last.fm secrets in the keychain:', e),
        );
        await s.set('settings', withoutSecrets(next));
        await s.save();
        return next;
      }
    } catch {
      /* fall through */
    }
    try {
      // Browser dev build only: there is no keychain here.
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  });
  // Keep the chain alive even if this write fails, so one failure never blocks
  // every later write.
  writeChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** Test hook: forget the in-memory copy so the next call re-reads storage. */
export function resetSettingsCache(): void {
  cached = null;
  store = null;
  savedSecrets = '';
}
