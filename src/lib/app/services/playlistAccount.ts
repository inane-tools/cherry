import { get, writable } from 'svelte/store';
import { authIdentity } from '$lib/infra/ytmusic/authContext';
import { getActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { activeChannelStore } from './channelProfile';

// Include a revision so switching A → B → A still invalidates old operations.
export const playlistAccountRevision = writable(0);
let identity = '';
function changed(): void {
  const next = JSON.stringify([authIdentity(get(authStore)), get(activeChannelStore)?.pageId ?? '']);
  if (next === identity) return;
  identity = next;
  playlistAccountRevision.update(value => value + 1);
}
authStore.subscribe(changed);
activeChannelStore.subscribe(changed);

export function capturePlaylistAccount() {
  const session = get(authStore);
  const channel = getActiveChannel();
  const revision = get(playlistAccountRevision);
  const current = () => get(playlistAccountRevision) === revision
    && authIdentity(get(authStore)) === authIdentity(session) && getActiveChannel() === channel;
  return { session, channel, revision, current };
}
