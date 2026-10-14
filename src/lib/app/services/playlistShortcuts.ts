import { get } from 'svelte/store';
import type { Playlist } from '$lib/core/models';
import { bestThumbnail } from '$lib/core/models';

/** Recent playlist shortcuts, persisted in most-recently-used order. */
let writes = Promise.resolve();
export function rememberPlaylist(playlist: Playlist): Promise<void> {
  const task = writes.then(async () => {
    // Settings initializes pins, which subscribe to the playlist store. Load it
    // after navigation/playback starts to avoid a module-initialization cycle.
    const { settingsStore, updateSettings } = await import('./settings');
    const recent = get(settingsStore).recentPlaylists ?? [];
    const next = { browseId: playlist.browseId, title: playlist.title, thumbnail: bestThumbnail(playlist.thumbnails, 96) };
    if (recent[0]?.browseId === next.browseId && recent[0]?.title === next.title) return;
    await updateSettings({ recentPlaylists: [next, ...recent.filter((p) => p.browseId !== next.browseId)].slice(0, 8) });
  });
  writes = task.catch(() => {});
  return writes;
}
