import { derived, get } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { invokeSafe, isTauri } from './platform';
import { playerStore, toggle, next, prev, toggleShuffle } from './player';
import { repeatMode, shuffleMode, setRepeat } from './queue';
import { pinnedStore } from './pins';
import { settingsStore } from './settings';
import { authStore } from './auth';
import { playlistStore, playPlaylist } from './playlists';
import { trackDisplayArtists, type RepeatMode } from '$lib/core/models';
import { prepareJumpArtwork, type PlaylistShortcut } from './jumpArtwork';

export async function startTray(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const windows = await invokeSafe<string>('desktop_platform') === 'windows';
  async function action(id: string) {
    if (id.startsWith('playlist:')) {
      const browseId = id.slice(9);
      const shortcut = [...get(pinnedStore), ...get(settingsStore).recentPlaylists].find((p) => p.browseId === browseId);
      if (get(authStore)) {
        await playPlaylist(get(playlistStore).find((p) => p.browseId === browseId) ?? { browseId, title: shortcut?.title ?? 'Playlist', thumbnails: [] });
      }
      return;
    }
    switch (id) {
      case 'toggle': await toggle(); break;
      case 'next': await next(); break;
      case 'prev': await prev(); break;
      case 'shuffle': toggleShuffle(); break;
      default: if (['repeat:off', 'repeat:all', 'repeat:one'].includes(id)) setRepeat(id.slice(7) as RepeatMode);
    }
  }
  const unlisten = await listen<string>('tray://action', (event) => void action(event.payload)).catch(() => () => {});
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTray = '';
  let lastJump = '';
  let pending: { state: Record<string, unknown>; pinned: PlaylistShortcut[]; recent: PlaylistShortcut[] } | undefined;
  let sending = false;
  async function flush() {
    if (sending || disposed) return;
    sending = true;
    while (pending && !disposed) {
      const data = pending;
      pending = undefined;
      const trayKey = JSON.stringify(data.state);
      if (trayKey !== lastTray) {
        await invokeSafe('update_tray', { state: data.state });
        lastTray = trayKey;
      }
      const jumpKey = JSON.stringify([data.pinned, data.recent]);
      if (jumpKey !== lastJump) {
        await invokeSafe('update_jump_list', { pinned: data.pinned, recent: data.recent });
        lastJump = jumpKey;
        if (windows) void prepareJumpArtwork([...data.pinned, ...data.recent]).then((changed) => {
          if (changed && !disposed && lastJump === jumpKey) {
            void invokeSafe('update_jump_list', { pinned: data.pinned, recent: data.recent });
          }
        });
      }
    }
    sending = false;
  }
  const unsubscribe = derived([playerStore, repeatMode, shuffleMode, pinnedStore, settingsStore, authStore], (values) => values).subscribe(([player, repeat, shuffle, pins, settings, auth]) => {
    const shortcut = ({ browseId, title, thumbnail = '' }: { browseId: string; title: string; thumbnail?: string }) => ({ browseId, title, thumbnail });
    const pinned = auth ? pins.map(shortcut) : [];
    const recent = auth ? settings.recentPlaylists.filter((p) => !pins.some((pin) => pin.browseId === p.browseId)).map(shortcut) : [];
    pending = {
      state: { title: player.track?.title ?? '', artist: player.track ? trackDisplayArtists(player.track) : '', album: player.track?.album?.name ?? '', hasTrack: !!player.track, playing: player.status === 'playing', shuffle, repeat, signedIn: !!auth, pinned },
      pinned, recent,
    };
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 100);
  });
  const launch = await invokeSafe<string>('take_playlist_launch');
  if (launch) void action(`playlist:${launch}`);
  return () => { disposed = true; unsubscribe(); unlisten(); if (timer !== undefined) clearTimeout(timer); };
}
