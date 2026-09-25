// Settings persistence: tauri-plugin-store on desktop, localStorage in browser.
// Auth cookies/visitor-data are sensitive → they go to the OS keychain via
// Rust commands (`auth_save`/`auth_load`/`auth_clear`), never here.

import { Store } from '@tauri-apps/plugin-store';
import { isTauri } from '$lib/app/services/platform';
import type { PinnedPlaylist } from '$lib/core/models';

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
  minimizeToTray: boolean;
  dynamicAccent: boolean;
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
  minimizeToTray: true,
  dynamicAccent: true,
};

const STORE_PATH = 'cherry-settings.json';
const LS_KEY = 'cherry.settings.v1';

let store: Store | null = null;

async function getStore(): Promise<Store | null> {
  if (!isTauri()) return null;
  if (!store) store = await Store.load(STORE_PATH);
  return store;
}

export async function loadSettings(): Promise<CherrySettings> {
  try {
    const s = await getStore();
    if (s) {
      const raw = await s.get<Partial<CherrySettings>>('settings');
      return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
    }
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(patch: Partial<CherrySettings>): Promise<CherrySettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
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
}
