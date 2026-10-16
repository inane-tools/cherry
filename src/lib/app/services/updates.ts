import { writable } from 'svelte/store';
// Intentionally disconnected from Cherry's Tauri releases and signing keys.
export const updateStore = writable({ environment: 'development', initialized: true, phase: 'idle', version: '', notes: '', received: 0, total: 0, error: '' });
export async function initializeUpdates(): Promise<void> {}
export async function checkUpdates(): Promise<void> {}
export async function downloadUpdate(): Promise<void> { throw new Error('Electron updates are not configured'); }
export async function installUpdate(): Promise<void> { throw new Error('Electron updates are not configured'); }
export function startUpdateChecks(): () => void { return () => {}; }
