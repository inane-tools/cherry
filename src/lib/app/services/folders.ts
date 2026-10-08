// Playlist folders + sidebar organisation.
//
// Folders live in settings (`playlistFolders`) and contain playlists in order.
// The sidebar's top level is a single user-organised list (`sidebarOrder`) that
// mixes playlists and folders — there is no forced grouping. Ids that are not in
// the order are appended in library order when rendered, so new playlists show
// up without any bookkeeping.

import { get, writable } from 'svelte/store';
import type { PlaylistFolder } from '$lib/core/models';
import { settingsStore, updateSettings } from './settings';

export const foldersStore = writable<PlaylistFolder[]>([]);
/** Top-level order: playlist ids and folder ids in one list. */
export const sidebarOrderStore = writable<string[]>([]);
/** Folders are expanded by default; this holds the ids the user collapsed. */
export const collapsedFolders = writable<Set<string>>(new Set());

function uid(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function initFolders(): void {
  foldersStore.set(get(settingsStore).playlistFolders ?? []);
  sidebarOrderStore.set(get(settingsStore).sidebarOrder ?? []);
  collapsedFolders.set(new Set(get(settingsStore).collapsedFolders ?? []));
}

async function persist(folders: PlaylistFolder[], order: string[]): Promise<void> {
  foldersStore.set(folders);
  sidebarOrderStore.set(order);
  await updateSettings({ playlistFolders: folders, sidebarOrder: order });
}

/** The folder containing a playlist, if any. */
export function folderFor(browseId: string): PlaylistFolder | null {
  return get(foldersStore).find((f) => f.playlistIds.includes(browseId)) ?? null;
}

function withoutId(list: string[], id: string): string[] {
  return list.filter((x) => x !== id);
}

function insertBefore(list: string[], id: string, beforeId: string | null): string[] {
  const at = beforeId ? list.indexOf(beforeId) : -1;
  if (at < 0) return [...list, id];
  return [...list.slice(0, at), id, ...list.slice(at)];
}

export async function createFolder(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const folder: PlaylistFolder = { id: uid(), name: trimmed, playlistIds: [] };
  // Left out of `sidebarOrder` so it appends at the end until moved.
  await persist([...get(foldersStore), folder], get(sidebarOrderStore));
  return folder.id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const folders = get(foldersStore).map((f) => (f.id === id ? { ...f, name: trimmed } : f));
  await persist(folders, get(sidebarOrderStore));
}

export async function deleteFolder(id: string): Promise<void> {
  const folders = get(foldersStore).filter((f) => f.id !== id);
  const order = withoutId(get(sidebarOrderStore), id);
  // Drop the folder's collapse state too, so a deleted id is not persisted
  // forever (and a new folder reusing the id can't inherit it).
  const collapsed = new Set(get(collapsedFolders));
  collapsed.delete(id);
  foldersStore.set(folders);
  sidebarOrderStore.set(order);
  collapsedFolders.set(collapsed);
  await updateSettings({
    playlistFolders: folders,
    sidebarOrder: order,
    collapsedFolders: [...collapsed],
  });
}

/**
 * Move `browseId` into `containerId` (a folder id, or `null` for the top
 * level), inserted before `beforeId` (or appended when null). Detaches it from
 * wherever it was first, so a playlist is never in two places.
 *
 * `order` lets the caller pass the fully-resolved top-level order (including
 * ids not yet persisted); it defaults to the stored order.
 */
export async function movePlaylist(
  browseId: string,
  containerId: string | null,
  beforeId: string | null,
  order?: string[],
): Promise<void> {
  const folders = get(foldersStore).map((f) => ({
    ...f,
    playlistIds: withoutId(f.playlistIds, browseId),
  }));
  let next = withoutId(order ?? get(sidebarOrderStore), browseId);

  if (containerId) {
    const withPlaylist = folders.map((f) =>
      f.id === containerId
        ? { ...f, playlistIds: insertBefore(f.playlistIds, browseId, beforeId) }
        : f,
    );
    await persist(withPlaylist, next);
  } else {
    next = insertBefore(next, browseId, beforeId);
    await persist(folders, next);
  }
}

/** Convenience: append to a folder (or move to the top level when null). */
export async function movePlaylistToFolder(
  browseId: string,
  folderId: string | null,
  order?: string[],
): Promise<void> {
  await movePlaylist(browseId, folderId, null, order);
}

/** Reorder a folder in the top-level list; `beforeId` null appends. */
export async function reorderFolder(
  folderId: string,
  beforeId: string | null,
  order?: string[],
): Promise<void> {
  const next = insertBefore(withoutId(order ?? get(sidebarOrderStore), folderId), folderId, beforeId);
  await persist(get(foldersStore), next);
}

export function toggleFolder(id: string): void {
  collapsedFolders.update((set) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Remembered across restarts.
    void updateSettings({ collapsedFolders: [...next] });
    return next;
  });
}
