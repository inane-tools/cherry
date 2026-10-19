// Developer tools are controlled through the isolated Electron bridge.

import { invokeSafe, isDesktop } from './platform';
import { get } from 'svelte/store';
import { settingsStore, updateSettings } from './settings';

let toggling = false;
/** Five logo clicks toggle the whole section, including its DevTools access. */
export async function toggleDeveloperOptions(): Promise<void> {
  if (toggling) return;
  toggling = true;
  try {
    const enabled = !get(settingsStore).developerUnlocked;
    await updateSettings({ developerUnlocked: enabled, ...(!enabled ? { devToolsEnabled: false } : {}) });
    if (!enabled) await invokeSafe('close_devtools');
    window.dispatchEvent(new CustomEvent('cherry:notice', { detail: {
      message: enabled
        ? 'In my restless dreams, I see those options. Sile- Developer Options.'
        : "I guess you weren't the one [ Good Ending ]",
    } }));
  } finally { toggling = false; }
}

/** Opens the renderer DevTools. Returns false in a non-desktop (browser) build. */
export async function openDevTools(): Promise<boolean> {
  const settings = get(settingsStore);
  if (!isDesktop() || !settings.developerUnlocked || !settings.devToolsEnabled) return false;
  await invokeSafe('open_devtools');
  return true;
}

/** Reload the frontend (handy while poking at DevTools). */
export function reloadFrontend(): void {
  window.location.reload();
}
