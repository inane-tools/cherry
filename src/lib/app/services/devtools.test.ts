import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '$lib/infra/storage/settingsRepo';

vi.mock('./platform', () => ({ isTauri: () => true, invokeSafe: vi.fn() }));
vi.mock('./settings', async () => {
  const { get, writable } = await import('svelte/store');
  const { DEFAULT_SETTINGS } = await import('$lib/infra/storage/settingsRepo');
  const settingsStore = writable({ ...DEFAULT_SETTINGS });
  return { settingsStore, updateSettings: vi.fn(async patch => {
    settingsStore.set({ ...get(settingsStore), ...patch });
  }) };
});
import { settingsStore } from './settings';
import { invokeSafe } from './platform';
import { openDevTools, toggleDeveloperOptions } from './devtools';

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.set({ ...DEFAULT_SETTINGS });
});

it('disables the section and tools, closes DevTools and shows the requested toast', async () => {
  settingsStore.set({ ...DEFAULT_SETTINGS, developerUnlocked: true, devToolsEnabled: true });
  const notice = vi.fn();
  window.addEventListener('cherry:notice', notice);
  try {
    await toggleDeveloperOptions();
    expect(get(settingsStore)).toMatchObject({ developerUnlocked: false, devToolsEnabled: false });
    expect(invokeSafe).toHaveBeenCalledWith('close_devtools');
    expect(notice.mock.calls[0][0].detail.message).toBe("I guess you weren't the one [ Good Ending ]");
    vi.mocked(invokeSafe).mockClear();
    expect(await openDevTools()).toBe(false);
    expect(invokeSafe).not.toHaveBeenCalled();
  } finally { window.removeEventListener('cherry:notice', notice); }
});

it('can unlock the section again without enabling DevTools automatically', async () => {
  await toggleDeveloperOptions();
  expect(get(settingsStore)).toMatchObject({ developerUnlocked: true, devToolsEnabled: false });
  expect(await openDevTools()).toBe(false);
  settingsStore.update(s => ({ ...s, devToolsEnabled: true }));
  expect(await openDevTools()).toBe(true);
  expect(invokeSafe).toHaveBeenCalledWith('open_devtools');
});

it('does not toggle twice when an earlier toggle is still saving', async () => {
  await Promise.all([toggleDeveloperOptions(), toggleDeveloperOptions()]);
  expect(get(settingsStore).developerUnlocked).toBe(true);
});
