import { derived } from 'svelte/store';
import { layoutWidth } from './layout';
import { settingsStore } from './settings';

export const QUEUE_SIDEBAR_WIDTH = 320;

// Reserve enough space for the page and player beside both rails.
export const queueSidebarVisible = derived(
  [layoutWidth, settingsStore],
  ([$width, $settings]) => {
    const leftWidth = $settings.compactSidebar ? 56 : Math.min(440, Math.max(176, $settings.sidebarWidth || 240));
    return $settings.queueSidebar && $width >= Math.max(820, leftWidth + QUEUE_SIDEBAR_WIDTH + 540);
  },
);
