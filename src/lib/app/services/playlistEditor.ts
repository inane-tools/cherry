// The playlist "Edit details" dialog.
//
// One dialog is rendered by the shell; the playlist page header and the context
// menu both open it through this store.

import { writable } from 'svelte/store';
import type { Playlist, Track } from '$lib/core/models';

export interface PlaylistEditorState {
  open: boolean;
  playlist: Playlist | null;
  tracks: Track[];
}

const CLOSED: PlaylistEditorState = { open: false, playlist: null, tracks: [] };

export const playlistEditorStore = writable<PlaylistEditorState>(CLOSED);

export function openPlaylistEditor(playlist: Playlist): void {
  playlistEditorStore.set({ open: true, playlist, tracks: [] });
}

export function openPlaylistCreator(tracks: Track[] = []): void {
  playlistEditorStore.set({ open: true, playlist: null, tracks: [...tracks] });
}

export function closePlaylistEditor(): void {
  playlistEditorStore.set(CLOSED);
}
