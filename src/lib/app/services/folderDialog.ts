// The create/rename folder dialog (one instance, rendered by the shell).

import { writable } from 'svelte/store';
import type { PlaylistFolder } from '$lib/core/models';

export interface FolderDialogState {
  open: boolean;
  /** null = creating a new folder; otherwise the folder being renamed. */
  folder: PlaylistFolder | null;
}

const CLOSED: FolderDialogState = { open: false, folder: null };

export const folderDialogStore = writable<FolderDialogState>(CLOSED);

export function openFolderDialog(folder: PlaylistFolder | null = null): void {
  folderDialogStore.set({ open: true, folder });
}

export function closeFolderDialog(): void {
  folderDialogStore.set(CLOSED);
}
