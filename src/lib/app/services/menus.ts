// Shared context-menu item builders, so every surface (track rows, playlist
// cards, the rail) offers the same actions.

import type { Album, ArtistRef, Playlist, PlaylistFolder, RadioEndpoint, Track } from '$lib/core/models';
import { get } from 'svelte/store';
import { playRadio } from './radio';
import { playTracks } from './player';
import { playPlaylist } from './playlists';
import { isPinned, togglePin, toggleAlbumPin, toggleArtistPin, toggleTrackPin } from './pins';
import {
  copyText,
  musicUrlForPlaylist,
  musicUrlForTrack,
  playlistYouTubeUrl,
  playlistMusicUrl,
  trackMusicUrl,
  trackYouTubeUrl,
} from './links';
import { notify, type ContextMenuItem } from './contextMenu';
import { authStore } from './auth';
import { announceSignInRequired } from './gate';
import { getDefaultPlaylist, removeTrackFrom, saveTrack, setDefaultPlaylist } from './playlistEdit';
import { isPlaylistOwned, isPlaylistSaved, ownershipKnown, savePlaylist, unsavePlaylist } from './playlistLibrary';
import { requestPlaylistDeletion } from './playlistDelete';
import {
  deleteFolder,
  folderFor,
  foldersStore,
  movePlaylistToFolder,
} from './folders';
import { openFolderDialog } from './folderDialog';
import { openPlaylistEditor } from './playlistEditor';
import { openPlaylistPicker } from './playlistPicker';
import { openSongCredits } from './songCredits';
import { queueTracks, queueCollection } from './queueActions';
import { openArtist, openTrackAlbum } from './catalog';

async function copy(label: string, url: string): Promise<void> {
  const ok = await copyText(url);
  notify(ok ? `${label} copied` : 'Could not copy to the clipboard');
}

/**
 * Menu for a single track. `list`/`index` let "Play" use the row's context;
 * `playlist` is passed when the row is shown on a playlist page, which adds the
 * "remove from this playlist" action.
 */
export function trackMenu(
  track: Track,
  list?: Track[],
  index = 0,
  playlist?: Playlist,
): ContextMenuItem[] {
  const signedIn = !!get(authStore);
  const canPlay = !!(signedIn && track.videoId);
  const preferred = getDefaultPlaylist();

  const items: ContextMenuItem[] = [
    {
      label: 'Play',
      quick: true,
      icon: 'ph-fill ph-play',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        const queue = list && list.length > 0 ? list : [track];
        const at = list && list.length > 0 ? index : 0;
        void playTracks(queue, at);
      },
    },
    { label: 'Add to queue', icon: 'ph ph-list-plus', quick: true, disabled: !canPlay, action: () => queueTracks([track]) },
  ];

  if (signedIn) {
    const pinned = isPinned(`song:${track.videoId}`);
    items.push({ label: pinned ? 'Unpin song' : 'Pin song', quick: true, icon: pinned ? 'ph-fill ph-push-pin-slash' : 'ph ph-push-pin', action: () => toggleTrackPin(track) });
    items.push({ label: 'Start mix', icon: 'ph-fill ph-play-circle', customIcon: 'mix', action: () => playRadio({ videoId: track.videoId }) });
    items.push({
      label: preferred ? `Add to “${preferred.title}”` : 'Add to playlist…',
      icon: 'ph ph-playlist',
      playlistArtwork: preferred?.thumbnails,
      quick: true,
      action: () => void saveTrack(track),
    });
    if (preferred) {
      items.push({
        label: 'Add to another playlist…',
        icon: 'ph ph-playlist',
        action: () => openPlaylistPicker([track]),
      });
    }
  }

  items.push(
    {
      label: 'Go to album',
      icon: 'ph ph-vinyl-record',
      action: () => openTrackAlbum(track),
    },
    {
      label: 'Song credits',
      icon: 'ph ph-info',
      action: () => void openSongCredits(track),
    },
    {
      label: 'Copy music link',
      brandIcon: 'youtube-music',
      separatorBefore: true,
      action: () => copy('YouTube Music link', musicUrlForTrack(track)),
    },
    {
      label: 'Copy video link',
      icon: 'ph-fill ph-youtube-logo',
      action: () => copy('YouTube link', trackYouTubeUrl(track.videoId)),
    },
  );

  if (signedIn && playlist && isPlaylistOwned(playlist.browseId)) {
    items.push({
      label: 'Remove from this playlist',
      icon: 'ph ph-trash',
      destructive: true,
      separatorBefore: true,
      action: () => void removeTrackFrom(playlist, track, index),
    });
  }

  return items;
}

/** Menu for a playlist. `opts.pin` adds the pin/unpin action (sidebar only). */
export function playlistMenu(playlist: Playlist, opts: { pin?: boolean } = {}): ContextMenuItem[] {
  const signedIn = !!get(authStore);
  const canPlay = signedIn;
  const pinned = isPinned(playlist.browseId);
  const isDefault = getDefaultPlaylist()?.browseId === playlist.browseId;
  const owned = isPlaylistOwned(playlist.browseId);
  const saved = isPlaylistSaved(playlist.browseId);

  const items: ContextMenuItem[] = [
    {
      label: 'Play',
      quick: true,
      icon: 'ph-fill ph-play',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        void playPlaylist(playlist, false);
      },
    },
    {
      label: 'Shuffle play',
      quick: true,
      icon: 'ph ph-shuffle',
      disabled: !canPlay,
      action: () => {
        if (!get(authStore)) return announceSignInRequired();
        void playPlaylist(playlist, true);
      },
    },
    { label: 'Add to queue', icon: 'ph ph-list-plus', quick: true, disabled: !canPlay, action: () => queueCollection(playlist) },
  ];

  if (signedIn) {
    if (owned) {
      items.push({
        label: 'Edit details…',
        icon: 'ph ph-pencil-simple',
        action: () => openPlaylistEditor(playlist),
      });
      items.push({
        label: isDefault ? 'Clear default playlist' : 'Set as default playlist',
        icon: isDefault ? 'ph-fill ph-check-circle' : 'ph ph-crosshair',
        action: () => void setDefaultPlaylist(isDefault ? null : playlist),
      });
    } else if (ownershipKnown()) {
      // Not your playlist: the only library action is save / unsave. (Until the
      // editable set loads we cannot tell, so no destructive action is offered.)
      items.push({
        label: saved ? 'Remove from library' : 'Save to library',
        icon: saved ? 'ph-fill ph-bookmark-simple' : 'ph ph-bookmark-simple',
        action: () => void (saved ? unsavePlaylist(playlist) : savePlaylist(playlist)),
      });
    }
  }

  // Folder moves are hidden for pinned playlists, which can't be moved.
  if (signedIn && !pinned) {
    const folders = get(foldersStore);
    const current = folderFor(playlist.browseId);
    const folderItems: ContextMenuItem[] = [];
    if (current) {
      folderItems.push({
        label: `Remove from “${current.name}”`,
        icon: 'ph ph-folder-minus',
        action: () => void movePlaylistToFolder(playlist.browseId, null),
      });
    }
    for (const folder of folders) {
      if (folder.id === current?.id) continue;
      folderItems.push({
        label: `Move to “${folder.name}”`,
        icon: 'ph-duotone ph-folder',
        action: () => void movePlaylistToFolder(playlist.browseId, folder.id),
      });
    }
    folderItems.push({
      label: 'New folder…',
      icon: 'ph ph-folder-plus',
      action: () => openFolderDialog(null),
    });
    folderItems[0].separatorBefore = folderItems.length > 1;
    items.push(...folderItems);
  }

  // Pin/unpin shows only in the sidebar menu, and never for folder members —
  // except a pinned one, which still needs a way to be unpinned.
  if (opts.pin && (pinned || !folderFor(playlist.browseId))) {
    items.push({
      label: pinned ? 'Unpin playlist' : 'Pin playlist',
      quick: true,
      icon: pinned ? 'ph-fill ph-push-pin-slash' : 'ph ph-push-pin',
      action: () => void togglePin(playlist),
    });
  }

  items.push(
    {
      label: 'Copy music link',
      brandIcon: 'youtube-music',
      separatorBefore: true,
      action: () => copy('YouTube Music link', musicUrlForPlaylist(playlist)),
    },
    {
      label: 'Copy video link',
      icon: 'ph-fill ph-youtube-logo',
      action: () => copy('YouTube link', playlistYouTubeUrl(playlist.browseId)),
    },
  );

  if (signedIn && owned) {
    items.push({ label: 'Delete playlist…', icon: 'ph ph-trash', destructive: true, separatorBefore: true, action: () => requestPlaylistDeletion(playlist) });
  }

  return items;
}

/** Albums can be queued without opening their detail page. */
export function albumMenu(album: Album): ContextMenuItem[] {
  const pinned = isPinned(album.browseId);
  return [{ label: 'Add to queue', icon: 'ph ph-list-plus', disabled: !get(authStore), action: () => queueCollection(album) },
    { label: pinned ? 'Unpin album' : 'Pin album', icon: pinned ? 'ph-fill ph-push-pin-slash' : 'ph ph-push-pin', disabled: !get(authStore), action: () => toggleAlbumPin(album) },
    { label: 'Copy music link', brandIcon: 'youtube-music', separatorBefore: true,
      action: () => copy('YouTube Music link', `https://music.youtube.com/browse/${encodeURIComponent(album.browseId)}`) }];
}

export function artistMenu(artist: ArtistRef): ContextMenuItem[] {
  const browseId = artist.browseId;
  if (!browseId) return [];
  const pinned = isPinned(browseId);
  const url = browseId.startsWith('UC')
    ? `https://music.youtube.com/channel/${encodeURIComponent(browseId)}`
    : `https://music.youtube.com/browse/${encodeURIComponent(browseId)}`;
  return [
    { label: 'Open artist', icon: 'ph ph-user', action: () => openArtist(artist) },
    { label: pinned ? 'Unpin artist' : 'Pin artist', icon: pinned ? 'ph-fill ph-push-pin-slash' : 'ph ph-push-pin', disabled: !get(authStore), action: () => toggleArtistPin(artist) },
    { label: 'Copy music link', brandIcon: 'youtube-music', separatorBefore: true, action: () => copy('YouTube Music link', url) },
    ...(browseId.startsWith('UC') ? [{
      label: 'Copy video link', icon: 'ph-fill ph-youtube-logo',
      action: () => copy('YouTube link', `https://www.youtube.com/channel/${encodeURIComponent(browseId)}`),
    }] : []),
  ];
}

/** A station has a dynamic queue, so use its radio endpoint rather than treating it as a saved playlist. */
export function stationMenu(endpoint: RadioEndpoint): ContextMenuItem[] {
  const playable = !!(endpoint.videoId || endpoint.playlistId);
  const url = new URL(endpoint.videoId ? trackMusicUrl(endpoint.videoId) : playlistMusicUrl(endpoint.playlistId ?? ''));
  if (endpoint.playlistId) url.searchParams.set('list', endpoint.playlistId.replace(/^VL/, ''));
  if (endpoint.params) url.searchParams.set('params', endpoint.params);
  const videoUrl = new URL(url);
  videoUrl.hostname = 'www.youtube.com';
  return [
    { label: 'Start mix', icon: 'ph-fill ph-play-circle', customIcon: 'mix', disabled: !get(authStore) || !playable, action: () => playRadio(endpoint) },
    ...(playable ? [
      { label: 'Copy music link', brandIcon: 'youtube-music' as const, separatorBefore: true, action: () => copy('YouTube Music link', url.href) },
      { label: 'Copy video link', icon: 'ph-fill ph-youtube-logo', action: () => copy('YouTube link', videoUrl.href) },
    ] : []),
  ];
}

/** Menu for a folder header in the sidebar. */
export function folderMenu(folder: PlaylistFolder): ContextMenuItem[] {
  return [
    {
      label: 'Rename folder…',
      icon: 'ph ph-pencil-simple',
      action: () => openFolderDialog(folder),
    },
    {
      label: 'Delete folder',
      icon: 'ph ph-trash',
      action: () => void deleteFolder(folder.id),
    },
  ];
}
