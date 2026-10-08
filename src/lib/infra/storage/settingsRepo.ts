// Settings persistence: tauri-plugin-store on desktop, localStorage in browser.
// Auth cookies/visitor-data are sensitive → they go to the OS keychain via
// Rust commands (`auth_save`/`auth_load`/`auth_clear`), never here.

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
      const raw = await s.get<Partial<CherrySettings>>('settings');
      loaded = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
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
        await s.set('settings', next);
        await s.save();
        return next;
      }
    } catch {
      /* fall through */
    }
    try {
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
