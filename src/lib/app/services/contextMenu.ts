// Global right-click context menu.
//
// One menu is rendered by the shell and driven by this store, so any surface
// can open it without owning the markup. Items are plain descriptors; the
// component renders and dispatches them.

import { writable } from 'svelte/store';
import type { Thumbnail } from '$lib/core/models';

export interface ContextMenuItem {
  label: string;
  /** Phosphor icon classes, e.g. `ph-fill ph-play`. */
  icon?: string;
  brandIcon?: 'youtube-music';
  customIcon?: 'mix';
  /** Playlist artwork with a small add badge; an empty array uses a fallback. */
  playlistArtwork?: Thumbnail[];
  /** Promote this action into the shortcut row on longer menus. */
  quick?: boolean;
  disabled?: boolean;
  /** Clearly mark actions that permanently delete something. */
  destructive?: boolean;
  /** Draw a divider *above* this item. */
  separatorBefore?: boolean;
  action: () => void | Promise<void>;
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const CLOSED: ContextMenuState = { open: false, x: 0, y: 0, items: [] };

export const contextMenuStore = writable<ContextMenuState>(CLOSED);

/** Open the menu at viewport coordinates (usually `event.clientX/Y`). */
export function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
  if (items.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  contextMenuStore.set({ open: true, x: event.clientX, y: event.clientY, items });
}

export function closeContextMenu(): void {
  contextMenuStore.set(CLOSED);
}

/** Announce a short message through the app's existing notice channel. */
export function notify(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cherry:notice', { detail: { message } }));
  }
}
