import { derived, get } from 'svelte/store';
import { listen } from '$lib/desktop/event';
import { invokeSafe, isDesktop } from './platform';
import { playerStore, toggle, next, prev, toggleShuffle } from './player';
import { repeatMode, shuffleMode, setRepeat } from './queue';
import { pinnedStore } from './pins';
import { settingsStore } from './settings';
import { authStore } from './auth';
import { playlistStore, playPlaylist } from './playlists';
import { openPage } from './navigation';
import { closeSearch, closeSettings } from './overlays';
import { isPlaylistPin, trackDisplayArtists, type RepeatMode } from '$lib/core/models';
import { prepareJumpArtwork, type PlaylistShortcut } from './jumpArtwork';

export async function startTray(): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const windows = await invokeSafe<string>('desktop_platform') === 'windows';
  async function action(id: string) {
    const opening = id.startsWith('open-playlist:');
    if (opening || id.startsWith('playlist:')) {
      const browseId = id.slice(opening ? 14 : 9);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(browseId)) return;
      const shortcut = [...get(pinnedStore).filter(isPlaylistPin), ...get(settingsStore).recentPlaylists].find((p) => p.browseId === browseId);
      if (get(authStore)) {
        const playlist = get(playlistStore).find((p) => p.browseId === browseId) ?? { browseId, title: shortcut?.title ?? 'Playlist', thumbnails: shortcut?.thumbnail ? [{ url: shortcut.thumbnail }] : [] };
        if (opening) { closeSearch(); closeSettings(); openPage({ view: 'playlist', entity: playlist }); }
        else await playPlaylist(playlist);
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
  const unlisten = await listen<string>('tray://action', (event) => void action(event.payload).catch(error => console.warn('[cherry] native action failed:', error))).catch(() => () => {});
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTray = '';
  let lastJump = '';
  let lastInputs: unknown[] = [];
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
    const inputs = [player.track, player.status, repeat, shuffle, pins, settings.recentPlaylists, !!auth];
    if (inputs.every((value, index) => Object.is(value, lastInputs[index]))) return;
    lastInputs = inputs;
    const shortcut = ({ browseId, title, thumbnail = '' }: { browseId: string; title: string; thumbnail?: string }) => ({ browseId, title, thumbnail });
    const playlistPins = pins.filter(isPlaylistPin);
    const pinned = auth ? playlistPins.map(shortcut) : [];
    const recent = auth ? settings.recentPlaylists.filter((p) => !playlistPins.some((pin) => pin.browseId === p.browseId)).map(shortcut) : [];
    pending = {
      state: { title: player.track?.title ?? '', artist: player.track ? trackDisplayArtists(player.track) : '', album: player.track?.album?.name ?? '', hasTrack: !!player.track, playing: player.status === 'playing', shuffle, repeat, signedIn: !!auth, pinned },
      pinned, recent,
    };
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 100);
  });
  const launch = await invokeSafe<string>('take_playlist_launch');
  if (launch) void action(`open-playlist:${launch}`).catch(error => console.warn('[cherry] playlist launch failed:', error));
  return () => { disposed = true; unsubscribe(); unlisten(); if (timer !== undefined) clearTimeout(timer); };
}
