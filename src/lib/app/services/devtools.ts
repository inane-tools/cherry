// Developer tools (WebView DevTools).
//
// The heavy lifting is in Rust (`devtools.rs`): `open_devtools` is only compiled
// into release builds because the `tauri` crate's `devtools` feature is enabled.
// In a plain browser there is nothing to open from script, so these no-op and
// the user uses the browser's own DevTools (F12) instead.

import { invokeSafe, isTauri } from './platform';

/** Opens the WebView DevTools. Returns false in a non-desktop (browser) build. */
export async function openDevTools(): Promise<boolean> {
  if (!isTauri()) return false;
  await invokeSafe('open_devtools');
  return true;
}

export async function isDevToolsOpen(): Promise<boolean> {
  if (!isTauri()) return false;
  return (await invokeSafe<boolean>('is_devtools_open')) ?? false;
}

/** Reload the frontend (handy while poking at DevTools). */
export function reloadFrontend(): void {
  window.location.reload();
}
