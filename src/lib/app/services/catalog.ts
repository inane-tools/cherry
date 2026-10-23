// Artist / album pages: open the page and load its data.

import { get, writable } from 'svelte/store';
import type { Album, ArtistRef, Track } from '$lib/core/models';
import {
  getAlbumPage,
  getArtistPage,
  getTrackAlbum,
  type AlbumPage,
  type ArtistPage,
} from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { openPage, pageStore } from './navigation';
import { notify } from './contextMenu';

export type { AlbumPage, ArtistPage };

// ── Artist ──────────────────────────────────────────────────────
export const openArtistStore = writable<ArtistRef | null>(null);
export const artistPageStore = writable<ArtistPage | null>(null);
export const artistLoading = writable(false);
export const artistError = writable<string | null>(null);

// ── Album ───────────────────────────────────────────────────────
export const openAlbumStore = writable<Album | null>(null);
export const albumPageStore = writable<AlbumPage | null>(null);
export const albumLoading = writable(false);
export const albumError = writable<string | null>(null);

export function openArtist(artist: ArtistRef): void {
  if (!artist.browseId) return;
  openPage({ view: 'artist', entity: artist });
}

export function openAlbum(album: Album): void {
  if (!album.browseId) return;
  openPage({ view: 'album', entity: album });
}

export async function openTrackAlbum(track: Track): Promise<void> {
  try {
    const album = track.album?.browseId ? track.album : await getTrackAlbum(track.videoId, get(authStore));
    if (!album?.browseId) { notify('No album available for this song'); return; }
    // A song's performers/composers need not be the album's credited artist.
    // Let the album response supply that line rather than showing a wrong hint.
    openAlbum({ browseId: album.browseId, title: album.name, artists: [], thumbnails: track.thumbnails });
  } catch { notify('Could not load the album'); }
}

let artistSeq = 0;

export async function loadArtistPage(artist: ArtistRef): Promise<void> {
  const id = ++artistSeq;
  openArtistStore.set(artist);
  artistPageStore.set(null);
  artistError.set(null);
  artistLoading.set(true);
  try {
    const page = await getArtistPage(artist.browseId ?? '', get(authStore));
    if (id !== artistSeq) return;
    artistPageStore.set(page);
    if (page?.thumbnails?.length) {
      pageStore.update(current => current.view === 'artist' && current.entity.browseId === artist.browseId
        ? { ...current, entity: { ...current.entity, thumbnails: page.thumbnails } } : current);
    }
  } catch (e) {
    if (id === artistSeq) artistError.set(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === artistSeq) artistLoading.set(false);
  }
}

let albumSeq = 0;

export async function loadAlbumPage(album: Album): Promise<void> {
  const id = ++albumSeq;
  openAlbumStore.set(album);
  albumPageStore.set(null);
  albumError.set(null);
  albumLoading.set(true);
  try {
    const page = await getAlbumPage(album.browseId, get(authStore));
    if (id !== albumSeq) return;
    albumPageStore.set(page);
    const resolved: Album = { ...album, title: page.title || album.title,
      artists: page.artists, year: page.year,
      thumbnails: page.thumbnails.length ? page.thumbnails : album.thumbnails };
    openAlbumStore.set(resolved);
    pageStore.update(current => current.view === 'album' && current.entity.browseId === album.browseId
      ? { ...current, entity: resolved } : current);
  } catch (e) {
    if (id === albumSeq) albumError.set(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === albumSeq) albumLoading.set(false);
  }
}
