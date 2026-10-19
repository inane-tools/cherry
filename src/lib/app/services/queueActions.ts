import { get } from 'svelte/store';
import type { Album, Playlist, Track } from '$lib/core/models';
import { getActiveChannel, getAlbumPage, getCollectionTracks } from '$lib/infra/ytmusic/InnertubeClient';
import { authIdentity } from '$lib/infra/ytmusic/authContext';
import { authStore } from './auth';
import { initChannel } from './account';
import { addToQueue } from './player';
import { notify } from './contextMenu';
import { announceSignInRequired } from './gate';
import { errorMessage } from './platform';

export function queueTracks(tracks: Track[]): void {
  const count = addToQueue(tracks);
  if (count) notify(count === 1 ? 'Added to queue' : `Added ${count} songs to queue`);
}

/** Resolve without navigating or replacing the current queue. */
export async function queueCollection(collection: Album | Playlist): Promise<void> {
  const session = get(authStore);
  if (!session) { announceSignInRequired(); return; }
  const sameAccount = () => authIdentity(get(authStore)) === authIdentity(session);
  let channel: string | undefined;
  const current = () => sameAccount() && (channel === undefined || channel === getActiveChannel());
  try {
    await initChannel();
    if (!current()) return;
    channel = getActiveChannel();
    let tracks: Track[];
    if ('artists' in collection) {
      const page = await getAlbumPage(collection.browseId, session);
      const artists = page.artists?.length ? page.artists : collection.artists;
      tracks = page.tracks.map(track => track.artists.length ? track : { ...track, artists });
    } else tracks = await getCollectionTracks(collection.browseId, session);
    if (!current()) return;
    if (!tracks.some(track => track.videoId)) { notify('No playable songs found.'); return; }
    queueTracks(tracks);
  } catch (error) {
    if (current()) notify(`Could not add to queue: ${errorMessage(error)}`);
  }
}
