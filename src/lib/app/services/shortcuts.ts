// In-app keyboard shortcuts.
//
// These work while the Cherry window is focused (the OS media keys and global
// shortcuts are handled separately in `mediaKeys.ts`). Typing in a field, or
// pressing keys on a focused control that already has a meaning for them
// (Space on a button, arrows on a slider), never triggers a shortcut.
//
// The binding table is data so Settings can list it and tests can check it
// without a DOM.

import { get } from 'svelte/store';
import {
  cycleRepeat,
  next,
  playerStore,
  prev,
  seekBy,
  setMuted,
  setVolume,
  toggle,
  toggleShuffle,
} from './player';
import { notify } from './contextMenu';
import { openSearch, openSettings } from './overlays';

export type ShortcutAction =
  | 'toggle'
  | 'next'
  | 'prev'
  | 'seekBack'
  | 'seekForward'
  | 'seekBackLong'
  | 'seekForwardLong'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'search'
  | 'settings';

export interface Shortcut {
  action: ShortcutAction;
  /** `KeyboardEvent.key` values (case-insensitive for letters). */
  keys: string[];
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  mod?: boolean;
  shift?: boolean;
  /** Shown in Settings. */
  label: string;
  /** Human-readable key combination for Settings. */
  display: string;
}

export const SHORTCUTS: Shortcut[] = [
  { action: 'toggle', keys: [' ', 'k'], label: 'Play / pause', display: 'Space or K' },
  { action: 'next', keys: ['ArrowRight'], mod: true, label: 'Next track', display: 'Ctrl + →' },
  { action: 'prev', keys: ['ArrowLeft'], mod: true, label: 'Previous track', display: 'Ctrl + ←' },
  { action: 'seekForward', keys: ['ArrowRight'], label: 'Forward 5 s', display: '→' },
  { action: 'seekBack', keys: ['ArrowLeft'], label: 'Back 5 s', display: '←' },
  { action: 'seekForwardLong', keys: ['l'], label: 'Forward 10 s', display: 'L' },
  { action: 'seekBackLong', keys: ['j'], label: 'Back 10 s', display: 'J' },
  { action: 'volumeUp', keys: ['ArrowUp'], mod: true, label: 'Volume up', display: 'Ctrl + ↑' },
  { action: 'volumeDown', keys: ['ArrowDown'], mod: true, label: 'Volume down', display: 'Ctrl + ↓' },
  { action: 'mute', keys: ['m'], label: 'Mute', display: 'M' },
  { action: 'shuffle', keys: ['s'], label: 'Shuffle', display: 'S' },
  { action: 'repeat', keys: ['r'], label: 'Repeat (off / all / one)', display: 'R' },
  { action: 'search', keys: ['f'], mod: true, label: 'Search', display: 'Ctrl + F or /' },
  { action: 'search', keys: ['/'], label: 'Search', display: '/' },
  { action: 'settings', keys: [','], mod: true, label: 'Settings', display: 'Ctrl + ,' },
];

/** Settings lists each action once. */
export const SHORTCUT_HELP = SHORTCUTS.filter(
  (s, i) => SHORTCUTS.findIndex((o) => o.action === s.action) === i,
);

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** The action bound to a key event, ignoring where it was typed. */
export function matchShortcut(event: KeyLike): ShortcutAction | null {
  if (event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  for (const shortcut of SHORTCUTS) {
    if (!shortcut.keys.includes(key)) continue;
    if (Boolean(shortcut.mod) !== mod) continue;
    // Shift is significant for letters (S vs Shift+S). For punctuation it is
    // ignored, because some layouts need Shift just to type `/` or `,`.
    if (shortcut.shift !== undefined) {
      if (shortcut.shift !== event.shiftKey) continue;
    } else if (event.shiftKey && /^[a-z]$/.test(key)) {
      continue;
    }
    return shortcut.action;
  }
  return null;
}

/**
 * True when the key press belongs to the focused element: text entry, or a
 * control that uses these keys itself.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"], [contenteditable=""]')) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
  }
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'slider' || role === 'combobox' || role === 'listbox';
}

/** Keys a focused button / link already handles. */
function claimedByControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button, a[href], [role="button"], [role="menuitem"], summary');
  return Boolean(control) && (key === ' ' || key === 'Enter');
}

const VOLUME_STEP = 0.05;

function run(action: ShortcutAction): void {
  const st = get(playerStore);
  switch (action) {
    case 'toggle':
      void toggle();
      break;
    case 'next':
      void next();
      break;
    case 'prev':
      void prev();
      break;
    case 'seekBack':
      seekBy(-5);
      break;
    case 'seekForward':
      seekBy(5);
      break;
    case 'seekBackLong':
      seekBy(-10);
      break;
    case 'seekForwardLong':
      seekBy(10);
      break;
    case 'volumeUp':
      setVolume(Math.round((st.volume + VOLUME_STEP) * 100) / 100);
      break;
    case 'volumeDown':
      setVolume(Math.round((st.volume - VOLUME_STEP) * 100) / 100);
      break;
    case 'mute':
      setMuted(!st.muted);
      break;
    case 'shuffle':
      toggleShuffle();
      break;
    case 'repeat': {
      const mode = cycleRepeat();
      notify(mode === 'off' ? 'Repeat off' : mode === 'all' ? 'Repeat all' : 'Repeat one');
      break;
    }
    case 'search':
      openSearch();
      break;
    case 'settings':
      openSettings();
      break;
  }
}

/** Handle one key press; returns the action taken (for tests). */
export function handleShortcut(event: KeyboardEvent): ShortcutAction | null {
  // Holding a key repeats only seeking / volume (arrows), never toggles.
  if (event.defaultPrevented || (event.repeat && !/^Arrow/.test(event.key))) return null;
  if (isEditableTarget(event.target)) return null;
  if (claimedByControl(event.target, event.key)) return null;
  const action = matchShortcut(event);
  if (!action) return null;
  event.preventDefault();
  run(action);
  return action;
}

/** Install the window listener. Returns the cleanup function. */
export function startShortcuts(): () => void {
  const listener = (event: KeyboardEvent) => void handleShortcut(event);
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
