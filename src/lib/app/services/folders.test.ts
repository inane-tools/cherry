import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const saved: Record<string, unknown>[] = [];
vi.mock('./settings', async () => {
  const { writable } = await import('svelte/store');
  return {
    settingsStore: writable({ playlistFolders: [], sidebarOrder: [], collapsedFolders: [] }),
    updateSettings: vi.fn(async (patch: Record<string, unknown>) => void saved.push(patch)),
  };
});

const folders = await import('./folders');

beforeEach(() => {
  saved.length = 0;
  folders.initFolders();
});

describe('folders', () => {
  it('creates, renames and deletes folders', async () => {
    const id = (await folders.createFolder('  Chill  '))!;
    expect(get(folders.foldersStore)).toEqual([{ id, name: 'Chill', playlistIds: [] }]);
    expect(await folders.createFolder('   ')).toBeNull();
    await folders.renameFolder(id, 'Calm');
    expect(get(folders.foldersStore)[0].name).toBe('Calm');
    folders.toggleFolder(id);
    await folders.deleteFolder(id);
    expect(get(folders.foldersStore)).toEqual([]);
    expect(get(folders.collapsedFolders).has(id)).toBe(false);
  });

  it('moves a playlist between top level and folders without duplicating it', async () => {
    const a = (await folders.createFolder('A'))!;
    const b = (await folders.createFolder('B'))!;
    await folders.movePlaylist('VL1', null, null, ['VL1', 'VL2']);
    expect(get(folders.sidebarOrderStore)).toEqual(['VL2', 'VL1']);
    await folders.movePlaylistToFolder('VL1', a);
    expect(folders.folderFor('VL1')?.id).toBe(a);
    expect(get(folders.sidebarOrderStore)).toEqual(['VL2']);
    await folders.movePlaylist('VL3', a, 'VL1');
    expect(get(folders.foldersStore).find((f) => f.id === a)?.playlistIds).toEqual(['VL3', 'VL1']);
    await folders.movePlaylistToFolder('VL1', b);
    expect(get(folders.foldersStore).find((f) => f.id === a)?.playlistIds).toEqual(['VL3']);
    expect(folders.folderFor('VL1')?.id).toBe(b);
    await folders.movePlaylist('VL1', null, 'VL2');
    expect(folders.folderFor('VL1')).toBeNull();
    expect(get(folders.sidebarOrderStore)).toEqual(['VL1', 'VL2']);
  });

  it('reorders folders in the top-level list', async () => {
    const a = (await folders.createFolder('A'))!;
    await folders.reorderFolder(a, 'VL2', ['VL1', 'VL2']);
    expect(get(folders.sidebarOrderStore)).toEqual(['VL1', a, 'VL2']);
  });

  it('persists every change', async () => {
    await folders.createFolder('A');
    expect(saved.at(-1)).toHaveProperty('playlistFolders');
  });
});
