// Window layout state: narrow mode (sidebar collapses into a drawer), the
// drawer itself, and whether the player bar is expanded.

import { writable } from 'svelte/store';

/** The sidebar is 15rem + content; below this the rail becomes a drawer. */
const NARROW_MAX_WIDTH = 820;

/** True when the window is too narrow for the inline playlist rail. */
export const narrowLayout = writable(false);
/** Whether the drawer rail is open in narrow mode. */
export const sidebarDrawerOpen = writable(false);
/** Whether the player bar is expanded into the bottom card. */
export const playerExpanded = writable(false);

export function closeSidebarDrawer(): void {
  sidebarDrawerOpen.set(false);
}
export function toggleSidebarDrawer(): void {
  sidebarDrawerOpen.update((v) => !v);
}

/** Begin tracking the window width. Returns a cleanup function. */
export function startLayoutTracking(): () => void {
  const update = () => {
    const narrow = window.innerWidth < NARROW_MAX_WIDTH;
    narrowLayout.set(narrow);
    // Leaving narrow mode should never leave the drawer "open" behind the rail.
    if (!narrow) sidebarDrawerOpen.set(false);
  };
  update();
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
}
