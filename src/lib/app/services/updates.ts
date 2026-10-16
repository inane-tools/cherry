import { get, writable } from 'svelte/store';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { errorMessage, invokeStrict, invokeSafe, isTauri } from './platform';
import { playerStore, toggle } from './player';
import { flushQueue } from './queuePersistence';
import { flushSettings } from '$lib/infra/storage/settingsRepo';

type Environment = 'windows' | 'appimage' | 'flatpak' | 'manual' | 'development';
type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export const updateStore = writable({
  environment: 'manual' as Environment, initialized: false, phase: 'idle' as Phase,
  version: '', notes: '', received: 0, total: 0, error: '',
});
let pending: Update | null = null;
let initializing: Promise<void> | undefined;
export function initializeUpdates(): Promise<void> {
  return initializing ??= (async () => {
    const environment = isTauri() ? await invokeStrict<Environment>('updater_environment') : 'development';
    updateStore.update(s => ({ ...s, environment, initialized: true }));
  })().catch(e => {
    initializing = undefined;
    throw e;
  });
}
export async function checkUpdates(): Promise<void> {
  if (['checking', 'downloading', 'ready', 'installing'].includes(get(updateStore).phase)) return;
  // Claim the operation before awaiting initialization, including concurrent clicks.
  updateStore.update(s => ({ ...s, phase: 'checking', error: '', version: '', notes: '' }));
  try {
    await initializeUpdates();
    if (!['windows', 'appimage'].includes(get(updateStore).environment)) {
      updateStore.update(s => ({ ...s, phase: 'idle' }));
      return;
    }
    if (pending) await pending.close();
    pending = null;
    const update = await check({ timeout: 15000 });
    pending = update;
    updateStore.update(s => ({ ...s, phase: update ? 'available' : 'current',
      version: update?.version ?? '', notes: update?.body ?? '', received: 0, total: 0 }));
  } catch (e) {
    updateStore.update(s => ({ ...s, phase: 'error', error: errorMessage(e, 'Could not check for updates.') }));
  }
}
export async function downloadUpdate(): Promise<void> {
  if (!pending || !['available', 'error'].includes(get(updateStore).phase)) return;
  updateStore.update(s => ({ ...s, phase: 'downloading', received: 0, total: 0, error: '' }));
  try {
    await pending.download(event => {
      if (event.event === 'Started') updateStore.update(s => ({ ...s, total: event.data.contentLength ?? 0 }));
      if (event.event === 'Progress') updateStore.update(s => ({ ...s, received: s.received + event.data.chunkLength }));
    }, { timeout: 120000 });
    updateStore.update(s => ({ ...s, phase: 'ready' }));
  } catch (e) {
    updateStore.update(s => ({ ...s, phase: 'error', error: errorMessage(e, 'Download failed. Please try again.') }));
  }
}
export async function installUpdate(): Promise<void> {
  if (!pending || get(updateStore).phase !== 'ready') return;
  updateStore.update(s => ({ ...s, phase: 'installing', error: '' }));
  try {
    if (get(playerStore).status === 'playing') await toggle();
    flushQueue();
    await flushSettings();
    await invokeSafe('discord_clear_presence');
    await pending.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    updateStore.update(s => ({ ...s, phase: 'ready', error: errorMessage(e, 'Installation failed. Please try again.') }));
  }
}
export function startUpdateChecks(): () => void {
  const timer = setTimeout(() => { void checkUpdates(); }, 5000);
  return () => clearTimeout(timer);
}
