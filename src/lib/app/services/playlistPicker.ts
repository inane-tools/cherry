// The "Add to playlist" / "New playlist" picker.
//
// One dialog is rendered by the shell and driven by this store, so any surface
// (track context menu, the sidebar's new-playlist button) can open it without
// owning the markup.

import { writable } from 'svelte/store';
import type { Track } from '$lib/core/models';

export interface PlaylistPickerState {
  open: boolean;
  /** Songs to add. Empty = the dialog only creates a playlist. */
  tracks: Track[];
}

const CLOSED: PlaylistPickerState = { open: false, tracks: [] };

export const playlistPickerStore = writable<PlaylistPickerState>(CLOSED);

export function openPlaylistPicker(tracks: Track[] = []): void {
  playlistPickerStore.set({ open: true, tracks });
}

export function closePlaylistPicker(): void {
  playlistPickerStore.set(CLOSED);
}
