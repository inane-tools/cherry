import { writable } from 'svelte/store';
import type { CherrySettings } from '$lib/infra/storage/settingsRepo';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '$lib/infra/storage/settingsRepo';
import { initPins } from './pins';

export const settingsStore = writable<CherrySettings>({ ...DEFAULT_SETTINGS });

export async function restoreSettings(): Promise<CherrySettings> {
  const s = await loadSettings();
  settingsStore.set(s);
  initPins();
  return s;
}

export async function updateSettings(patch: Partial<CherrySettings>): Promise<void> {
  const next = await saveSettings(patch);
  settingsStore.set(next);
}
