// WebView2 memory trimming.
//
// Chromium keeps its full working set even when the window is hidden to the
// tray. When the window loses focus we ask WebView2 for its "low" memory target
// level (aggressive cache release), and restore "normal" on focus so the UI
// stays smooth while it is actually being used.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { invokeSafe, isTauri } from './platform';

/**
 * Start trimming on blur and restoring on focus. Returns an unsubscribe
 * function (a no-op outside the desktop app or if the window API is missing).
 */
export async function startMemoryTrimming(): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      void invokeSafe('set_webview_memory_low', { low: !focused });
    });
    return unlisten;
  } catch {
    return () => {};
  }
}
