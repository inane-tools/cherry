import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '$lib/infra/storage/settingsRepo';
vi.mock('./settings', async () => ({ settingsStore: (await import('svelte/store')).writable({}) }));
import { settingsStore } from './settings';
import { layoutWidth, startLayoutTracking } from './layout';
import { queueSidebarVisible } from './queueSidebar';

beforeEach(() => {
  settingsStore.set({ ...DEFAULT_SETTINGS });
  layoutWidth.set(1400);
});

it('only shows the persistent queue when enabled and both rails fit', () => {
  expect(get(queueSidebarVisible)).toBe(false);
  settingsStore.update((s) => ({ ...s, queueSidebar: true }));
  expect(get(queueSidebarVisible)).toBe(true);
  layoutWidth.set(1099);
  expect(get(queueSidebarVisible)).toBe(false);
  layoutWidth.set(1100);
  expect(get(queueSidebarVisible)).toBe(true);
  settingsStore.update((s) => ({ ...s, sidebarWidth: 440 }));
  expect(get(queueSidebarVisible)).toBe(false);
  layoutWidth.set(1300);
  expect(get(queueSidebarVisible)).toBe(true);
});

it('makes use of the compact rail while reserving space for the page', () => {
  settingsStore.update((s) => ({ ...s, queueSidebar: true, compactSidebar: true }));
  layoutWidth.set(916);
  expect(get(queueSidebarVisible)).toBe(true);
  layoutWidth.set(915);
  expect(get(queueSidebarVisible)).toBe(false);
});

it('responds to viewport changes and cleans up the resize listener', () => {
  settingsStore.update((s) => ({ ...s, queueSidebar: true }));
  const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  const stop = startLayoutTracking();
  expect(get(queueSidebarVisible)).toBe(true);
  width.mockReturnValue(900);
  window.dispatchEvent(new Event('resize'));
  expect(get(queueSidebarVisible)).toBe(false);
  stop();
  width.mockReturnValue(1400);
  window.dispatchEvent(new Event('resize'));
  expect(get(queueSidebarVisible)).toBe(false);
});
