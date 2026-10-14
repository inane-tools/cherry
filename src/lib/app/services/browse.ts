// Shared helpers for turning YouTube shelves (home / explore / artist) into
// carousel entries, and for what a click does: songs play, cards open their
// album / artist / playlist page.

import type { ArtistRef, Thumbnail, Track } from '$lib/core/models';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
import { playTracks } from './player';
import { openPlaylist, playPlaylist } from './playlists';
import { openAlbum, openArtist } from './catalog';
import { get } from 'svelte/store';
import { authStore } from './auth';
import { getAlbumPage } from '$lib/infra/ytmusic/InnertubeClient';
import { notify } from './contextMenu';
import { errorMessage } from './platform';
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
    title: card.title,
    subtitle: card.subtitle,
    thumbnails: card.thumbnails,
    kind: 'card',
    canPlay: /^(VL|PL|RD|MPR)/.test(card.browseId) || card.browseId.startsWith('FEmusic_library_privately_owned_release'),
    round: card.browseId.startsWith('UC') || card.pageType === 'MUSIC_PAGE_TYPE_ARTIST',
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
    title: song.title,
    artists: song.subtitle ? [{ name: song.subtitle }] : [],
    thumbnails: song.thumbnails,
  }));
}

/** Open a browse id on the right page type. */
export function openBrowseCard(
  browseId: string,
  title: string,
  thumbnails: Thumbnail[],
  subtitle?: string,
  params?: string,
): void {
  if (!browseId) return;
  if (browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release')) {
    openAlbum({ browseId, title, artists: artistsFromSubtitle(subtitle), thumbnails });
  } else if (browseId.startsWith('UC') || browseId.startsWith('FEmusic_library_privately_owned_artist')) {
    openArtist({ name: title, browseId });
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
  openBrowseCard(entry.browseId ?? entry.key.slice(2), entry.title, entry.thumbnails, entry.subtitle, entry.browseParams);
}

/** Play the collection without navigating away from the Home/artist page. */
export async function playCarouselEntry(section: HomeSection, entry: CarouselEntry): Promise<void> {
  if (entry.kind === 'song') return selectCarouselEntry(section, entry);
  if (entry.canPlay === false) return;
  try {
    const browseId = entry.browseId ?? entry.key.slice(2);
    if (browseId.startsWith('MPR') || browseId.startsWith('FEmusic_library_privately_owned_release')) {
      const album = await getAlbumPage(browseId, get(authStore));
      if (!album.tracks.length) { notify('No playable songs found in this album.'); return; }
      await playTracks(album.tracks.map((track) => track.artists.length ? track : { ...track, artists: album.artists }));
    } else {
      await playPlaylist({ browseId, title: entry.title, thumbnails: entry.thumbnails });
    }
  } catch (error) { notify(errorMessage(error, 'Could not play this collection.')); }
}
