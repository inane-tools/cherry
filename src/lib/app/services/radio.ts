import { get } from 'svelte/store';
import type { RadioEndpoint } from '$lib/core/models';
import { getActiveChannel, getRadioPage } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { playerStore, playTracks } from './player';
import { queueItems, upNextQueue, enqueue, cutQueueTo, currentItem } from './queue';
import { notify } from './contextMenu';
import { errorMessage } from './platform';

let generation = 0;
let active: { endpoint: RadioEndpoint; continuation?: string; cookie: string; channel: string; ids: Set<string>; tokens: Set<string> } | null = null;
let loading = false;
export async function playRadio(endpoint: RadioEndpoint): Promise<void> {
  const session = get(authStore);
  if (!session) { notify('Sign in with YouTube Music to play a station.'); return; }
  const id = ++generation; active = null; loading = false;
  const channel = getActiveChannel();
  const previousQueue = get(queueItems);
  try {
    const page = await getRadioPage(endpoint, session);
    if (id !== generation || get(authStore)?.cookie !== session.cookie || channel !== getActiveChannel() || get(queueItems) !== previousQueue) return;
    if (!page.tracks.length) throw new Error('This station has no playable tracks right now.');
    const playback = playTracks(page.tracks);
    const ids = new Set(get(queueItems).map(item => item.queueId));
    await playback;
    if (id !== generation || get(authStore)?.cookie !== session.cookie || channel !== getActiveChannel()) return;
    if (!get(queueItems).some(item => ids.has(item.queueId))) return;
    active = { endpoint: { ...(page.endpoint ?? endpoint), playlistId: page.playlistId ?? page.endpoint?.playlistId ?? endpoint.playlistId }, continuation: page.continuation,
      cookie: session.cookie, channel, ids, tokens: new Set() };
  } catch (error) { if (id === generation) notify(errorMessage(error, 'Could not play this station.')); }
}
export function startRadioRefill(): () => void {
  const stop = playerStore.subscribe(state => {
    const radio = active; const session = get(authStore);
    if (!radio) return;
    if (!session || session.cookie !== radio.cookie || radio.channel !== getActiveChannel()
      || !get(queueItems).some(item => radio.ids.has(item.queueId))) { active = null; generation++; return; }
    if (loading || !radio.continuation || get(upNextQueue).length > 3 || state.status !== 'playing') return;
    const token = radio.continuation;
    if (radio.tokens.has(token)) { radio.continuation = undefined; return; }
    radio.tokens.add(token); loading = true;
    const id = generation;
    void getRadioPage(radio.endpoint, session, token).then(page => {
      if (id !== generation || active !== radio || get(authStore)?.cookie !== radio.cookie || radio.channel !== getActiveChannel()) return;
      const existing = new Set(get(queueItems).map(item => item.track.videoId));
      const tracks = page.tracks.filter(track => !existing.has(track.videoId));
      radio.continuation = page.continuation;
      const current = get(currentItem);
      if (current && get(queueItems).length > 200) cutQueueTo(current.queueId);
      enqueue(tracks);
      radio.ids = new Set(get(queueItems).map(item => item.queueId));
    }).catch(() => { if (active === radio) { radio.continuation = undefined; notify('Could not load more station tracks. The queued songs will still play.'); } })
      .finally(() => { if (id === generation) loading = false; });
  });
  return () => { stop(); active = null; generation++; loading = false; };
}
