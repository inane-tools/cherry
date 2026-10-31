import { get } from 'svelte/store';
import type { QueueSource, RadioEndpoint } from '$lib/core/models';
import { authIdentity } from '$lib/infra/ytmusic/authContext';
import { getActiveChannel, getRadioPage } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { playerStore, playTracks } from './player';
import { queueItems, queueSource, upNextQueue, enqueue, cutQueueTo, currentItem } from './queue';
import { notify } from './contextMenu';
import { errorMessage } from './platform';

let generation = 0;
let active: { endpoint: RadioEndpoint; continuation?: string; account: string; channel: string; source: QueueSource; ids: Set<string>; tokens: Set<string> } | null = null;
let loading = false;
export type RadioPage = Awaited<ReturnType<typeof getRadioPage>>;
export async function playRadio(endpoint: RadioEndpoint, options: {
  title?: string; startAt?: number;
  initial?: { page: RadioPage; account: string; channel: string };
} = {}): Promise<void> {
  const session = get(authStore);
  if (!session) { notify('Sign in with YouTube Music to play a mix.'); return; }
  const id = ++generation; active = null; loading = false;
  const channel = getActiveChannel();
  const account = authIdentity(session);
  const previousQueue = get(queueItems);
  try {
    const page = options.initial?.account === account && options.initial.channel === channel ? options.initial.page : await getRadioPage(endpoint, session);
    if (id !== generation || authIdentity(get(authStore)) !== account || channel !== getActiveChannel() || get(queueItems) !== previousQueue) return;
    if (!page.tracks.length) throw new Error('This mix has no playable tracks right now.');
    const resolvedEndpoint = { ...(page.endpoint ?? endpoint), playlistId: page.playlistId ?? page.endpoint?.playlistId ?? endpoint.playlistId };
    const source: QueueSource = { kind: 'mix', title: options.title ?? 'Mix', endpoint: resolvedEndpoint };
    const playback = playTracks(page.tracks, options.startAt ?? 0, source);
    const ids = new Set(get(queueItems).map(item => item.queueId));
    await playback;
    if (id !== generation || authIdentity(get(authStore)) !== account || channel !== getActiveChannel() || get(queueSource) !== source) return;
    if (!get(queueItems).some(item => ids.has(item.queueId))) return;
    active = { endpoint: resolvedEndpoint, continuation: page.continuation,
      account, channel, source, ids, tokens: new Set() };
  } catch (error) { if (id === generation) notify(errorMessage(error, 'Could not play this mix.')); }
}
export function startRadioRefill(): () => void {
  const stop = playerStore.subscribe(state => {
    const radio = active; const session = get(authStore);
    if (!radio) return;
    if (!session || authIdentity(session) !== radio.account || radio.channel !== getActiveChannel() || get(queueSource) !== radio.source
      || !get(queueItems).some(item => radio.ids.has(item.queueId))) { active = null; generation++; return; }
    if (loading || !radio.continuation || get(upNextQueue).length > 3 || state.status !== 'playing') return;
    const token = radio.continuation;
    if (radio.tokens.has(token)) { radio.continuation = undefined; return; }
    radio.tokens.add(token); loading = true;
    const id = generation;
    void getRadioPage(radio.endpoint, session, token).then(page => {
      if (id !== generation || active !== radio || authIdentity(get(authStore)) !== radio.account || radio.channel !== getActiveChannel() || get(queueSource) !== radio.source) return;
      const existing = new Set(get(queueItems).map(item => item.track.videoId));
      const tracks = page.tracks.filter(track => !existing.has(track.videoId));
      radio.continuation = page.continuation;
      const current = get(currentItem);
      if (current && get(queueItems).length > 200) cutQueueTo(current.queueId);
      enqueue(tracks, false, { automatic: true });
      radio.ids = new Set(get(queueItems).map(item => item.queueId));
    }).catch(() => { if (active === radio) { radio.continuation = undefined; notify('Could not load more mix tracks. The queued songs will still play.'); } })
      .finally(() => { if (id === generation) loading = false; });
  });
  return () => { stop(); active = null; generation++; loading = false; };
}
