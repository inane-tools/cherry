// Shared helpers for turning YouTube shelves (home / explore / artist) into
// carousel entries, and for what a click does: songs play, cards open their
// album / artist / playlist page.

import type { ArtistRef, Thumbnail, Track } from '$lib/core/models';
import type { BrowseTarget, HomeSection } from '$lib/infra/ytmusic/rawHome';
import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
import { playTracks } from './player';
import { openPlaylist, playPlaylist } from './playlists';
import { openAlbum, openArtist } from './catalog';
import { get } from 'svelte/store';
import { authStore } from './auth';
import { getAlbumPage } from '$lib/infra/ytmusic/InnertubeClient';
import { notify, openContextMenu } from './contextMenu';
import { errorMessage } from './platform';
import { playRadio } from './radio';
import { openPage } from './navigation';

/** Card subtitles look like "Single · Camellia" — pull the artist out of that. */
const MEDIA_TYPE = /^(single|album|ep|playlist|video|song|compilation|soundtrack|live)$/i;

function artistsFromSubtitle(subtitle?: string): ArtistRef[] {
  if (!subtitle) return [];
  return subtitle
    .split(/[·•]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !MEDIA_TYPE.test(part))
    .filter((part) => !/^(19|20)\d{2}$/.test(part) && !/^\d/.test(part))
    .slice(0, 2)
    .map((name) => ({ name }));
}

export function entriesOf(section: HomeSection): CarouselEntry[] {
  const cards: CarouselEntry[] = section.cards.map((card) => ({
    key: `c:${card.browseId}${card.params ? `:${card.params}` : ''}`,
    browseId: card.browseId,
    browseParams: card.params,
    pageType: card.pageType,
    title: card.title,
    subtitle: card.subtitle,
    thumbnails: card.thumbnails,
    kind: 'card',
    playback: card.playback,
    canPlay: card.pageType !== 'MUSIC_PAGE_TYPE_USER_CHANNEL' && (!!card.playback || /^(VL|PL|RD|MPR)/.test(card.browseId) || card.browseId.startsWith('FEmusic_library_privately_owned_release')),
    round: card.browseId.startsWith('UC') || card.pageType === 'MUSIC_PAGE_TYPE_ARTIST' || card.pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL',
  }));
  const songs: CarouselEntry[] = section.songs.map((song) => ({
    key: `s:${song.videoId}`,
    title: song.title,
    subtitle: song.subtitle,
    thumbnails: song.thumbnails,
    kind: 'song',
  }));
  const entries = [...cards, ...songs];
  if (!section.order) return entries;
  const rank = new Map(section.order.map((key, index) => [key, index]));
  return entries.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
}

export function sectionTracks(section: HomeSection): Track[] {
  return section.songs.map((song) => ({
    videoId: song.videoId,
    isMusicVideo: song.isMusicVideo,
    title: song.title,
    artists: song.subtitle ? [{ name: song.subtitle }] : [],
    thumbnails: song.thumbnails,
  }));
}

/** Use the same menus on Home, Explore and artist-page carousels. */
export async function openCarouselMenu(section: HomeSection, entry: CarouselEntry, event: MouseEvent): Promise<void> {
  const browseId = entry.browseId ?? entry.key.slice(2);
  event.preventDefault();
  event.stopPropagation();
  // Menus pull in library editing; load them only when actually requested.
  const { trackMenu, playlistMenu, albumMenu, artistMenu, stationMenu } = await import('./menus');
  if (entry.kind === 'song') {
    const tracks = sectionTracks(section);
    const index = tracks.findIndex(track => `s:${track.videoId}` === entry.key);
    if (index >= 0) openContextMenu(event, trackMenu(tracks[index], tracks, index));
    return;
  }
  if (entry.pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL') {
    openContextMenu(event, [{ label: 'Open profile', icon: 'ph ph-user', action: () => openProfile({ browseId, params: entry.browseParams }, entry.title, entry.thumbnails) }]);
  } else if (entry.pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId.startsWith('UC') || browseId.startsWith('FEmusic_library_privately_owned_artist')) {
    openContextMenu(event, artistMenu({ browseId, name: entry.title }));
  } else if (entry.pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release')) {
    openContextMenu(event, albumMenu({ browseId, title: entry.title, thumbnails: entry.thumbnails, artists: artistsFromSubtitle(entry.subtitle) }));
  } else if (/^(?:VL)?RD/.test(browseId) || browseId.startsWith('station:') || (!entry.browseId && entry.playback)) {
    const endpoint = entry.playback ?? { playlistId: browseId.replace(/^VL/, '') };
    openContextMenu(event, stationMenu(endpoint));
  } else if (entry.pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' || /^(VL|PL|OLAK)/.test(browseId)) {
    openContextMenu(event, playlistMenu({ browseId, title: entry.title, thumbnails: entry.thumbnails }));
  } else if (browseId) {
    openContextMenu(event, [{ label: 'Open', icon: 'ph ph-arrow-right', action: () => selectCarouselEntry(section, entry) }]);
  }
}

/** Open a browse id on the right page type. */
export function openProfile(target: BrowseTarget, name: string, thumbnails: Thumbnail[] = []): void {
  openPage({ view: 'browse', entity: { browseId: target.browseId, title: name || 'Profile', params: target.params, kind: 'profile', thumbnails } });
}

export function openBrowseCard(
  browseId: string,
  title: string,
  thumbnails: Thumbnail[],
  subtitle?: string,
  params?: string,
  pageType?: string,
): void {
  if (!browseId) return;
  if (pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL') {
    openProfile({ browseId, params }, title, thumbnails);
  } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release')) {
    openAlbum({ browseId, title, artists: artistsFromSubtitle(subtitle), thumbnails });
  } else if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || browseId.startsWith('UC') || browseId.startsWith('FEmusic_library_privately_owned_artist')) {
    openArtist({ name: title, browseId, ...(thumbnails.length ? { thumbnails } : {}) });
  } else if (browseId.startsWith('FE')) {
    openPage({ view: 'browse', entity: { browseId, title, params } });
  } else {
    openPlaylist({ browseId, title, thumbnails });
  }
}

export async function selectCarouselEntry(section: HomeSection, entry: CarouselEntry): Promise<void> {
  if (entry.kind === 'song') {
    const tracks = sectionTracks(section);
    const index = tracks.findIndex((t) => `s:${t.videoId}` === entry.key);
    if (tracks.length > 0) await playTracks(tracks, index < 0 ? 0 : index);
    return;
  }
  if (entry.playback && (!entry.browseId || /^VL?RD/.test(entry.browseId) || entry.browseId.startsWith('RD') || entry.browseId.startsWith('station:'))) { await playRadio(entry.playback); return; }
  openBrowseCard(entry.browseId ?? entry.key.slice(2), entry.title, entry.thumbnails, entry.subtitle, entry.browseParams, entry.pageType);
}

/** Play the collection without navigating away from the Home/artist page. */
export async function playCarouselEntry(section: HomeSection, entry: CarouselEntry): Promise<void> {
  if (entry.kind === 'song') return selectCarouselEntry(section, entry);
  if (entry.canPlay === false) return;
  try {
    const browseId = entry.browseId ?? entry.key.slice(2);
    // A collection's overlay may start a recommendation mix rather than the
    // collection shown on the card. Only stations use that watch endpoint.
    if (entry.playback && (!entry.browseId || /^(?:VL)?RD/.test(browseId) || browseId.startsWith('station:'))) {
      await playRadio(entry.playback); return;
    }
    if (browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release')) {
      const album = await getAlbumPage(browseId, get(authStore));
      if (!album.tracks.length) { notify('No playable songs found in this album.'); return; }
      await playTracks(album.tracks.map((track) => track.artists.length ? track : { ...track, artists: album.artists }));
    } else {
      await playPlaylist({ browseId, title: entry.title, thumbnails: entry.thumbnails });
    }
  } catch (error) { notify(errorMessage(error, 'Could not play this collection.')); }
}
