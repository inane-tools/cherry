// Overlay panels that float above the current page instead of navigating:
// Settings and Search. Kept in their own store so they never disturb the page
// history (the sidebar/top bar stay put underneath).

import { writable } from 'svelte/store';

export const settingsOpen = writable(false);
export const searchOpen = writable(false);

export function openSettings(): void {
  settingsOpen.set(true);
}
export function closeSettings(): void {
  settingsOpen.set(false);
}

export function openSearch(): void {
  searchOpen.set(true);
}
export function closeSearch(): void {
  searchOpen.set(false);
}
