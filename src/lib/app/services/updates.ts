import { get, writable } from 'svelte/store';
import { invokeStrict, isDesktop, errorMessage } from './platform';
import { playerStore, toggle } from './player';
import { flushQueue } from './queuePersistence';
import { flushSettings } from '$lib/infra/storage/settingsRepo';

type Environment = 'windows' | 'appimage' | 'flatpak' | 'manual' | 'development';
type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export interface UpdateState {
  environment: Environment; initialized: boolean; phase: Phase;
  version: string; notes: string; received: number; total: number; error: string;
}
export const updateStore = writable<UpdateState>({ environment: 'development', initialized: false, phase: 'idle', version: '', notes: '', received: 0, total: 0, error: '' });
let initializing: Promise<void> | undefined;
let subscribed = false;
export function initializeUpdates(): Promise<void> {
  return initializing ??= (async () => {
    if (!isDesktop()) { updateStore.update(s => ({ ...s, initialized: true })); return; }
    if (!subscribed) {
      window.cherryDesktop!.subscribe('updater-state', payload => updateStore.set(payload as UpdateState));
      subscribed = true;
    }
    updateStore.set(await invokeStrict<UpdateState>('updater_state'));
  })().catch(error => { initializing = undefined; throw error; });
}
async function run(command: string): Promise<void> {
  try { await initializeUpdates(); if (!isDesktop()) return; updateStore.set(await invokeStrict<UpdateState>(command)); }
  catch (error) { updateStore.update(s => ({ ...s, phase: 'error', error: errorMessage(error) })); }
}
export async function checkUpdates(): Promise<void> { await run('updater_check'); }
export async function downloadUpdate(): Promise<void> { await run('updater_download'); }
export async function installUpdate(): Promise<void> {
  if (get(updateStore).phase !== 'ready') return;
  try {
    if (get(playerStore).status === 'playing') await toggle();
    flushQueue();
    await flushSettings();
    await run('updater_install');
  } catch (error) { updateStore.update(s => ({ ...s, error: errorMessage(error) })); }
}
export function startUpdateChecks(): () => void {
  const check = () => { void checkUpdates(); };
  const timer = setTimeout(check, 5000);
  const interval = setInterval(check, 4 * 60 * 60 * 1000);
  return () => { clearTimeout(timer); clearInterval(interval); };
}
