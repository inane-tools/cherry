import { invoke } from './core';
import { listen } from './event';
const current = {
  minimize: () => invoke<void>('window:minimize'),
  close: () => invoke<void>('window:close'),
  toggleMaximize: () => invoke<void>('window:toggle-maximize'),
  isMaximized: () => invoke<boolean>('window:is-maximized'),
  isFullscreen: () => invoke<boolean>('window:is-fullscreen'),
  setTitle: (title: string) => invoke<void>('window:title', { title }),
  onResized: (callback: () => void) => listen('window-resized', callback),
  onFocusChanged: (callback: (event: { payload: boolean }) => void) => listen<boolean>('window-focus', callback),
};
export function getCurrentWindow() { return current; }
