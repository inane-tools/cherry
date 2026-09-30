// The playlist "Edit details" dialog.
//
// One dialog is rendered by the shell; the playlist page header and the context
// menu both open it through this store.

import { writable } from 'svelte/store';
import type { Playlist } from '$lib/core/models';

export interface PlaylistEditorState {
  open: boolean;
  playlist: Playlist | null;
}

const CLOSED: PlaylistEditorState = { open: false, playlist: null };

export const playlistEditorStore = writable<PlaylistEditorState>(CLOSED);

export function openPlaylistEditor(playlist: Playlist): void {
  playlistEditorStore.set({ open: true, playlist });
}

export function closePlaylistEditor(): void {
  playlistEditorStore.set(CLOSED);
}
