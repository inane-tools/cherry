// Global right-click context menu.
//
// One menu is rendered by the shell and driven by this store, so any surface
// can open it without owning the markup. Items are plain descriptors; the
// component renders and dispatches them.

import { writable } from 'svelte/store';

export interface ContextMenuItem {
  label: string;
  /** Boxicons class, e.g. `bx bx-play`. */
  icon?: string;
  disabled?: boolean;
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
