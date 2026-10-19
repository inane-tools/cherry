import { get, writable } from 'svelte/store';
import { authIdentity } from '$lib/infra/ytmusic/authContext';
import { authStore } from './auth';
import { activeChannelStore } from './account';
import { repeatListening, type RepeatListening } from '$lib/core/profileSections';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import { getActiveChannel, getBrowsePage } from '$lib/infra/ytmusic/InnertubeClient';

// Only keep listening hints in memory, and discard them on account/channel changes.
export const repeatListeningStore = writable<RepeatListening>({ artists: [], songs: [], playlists: [] });
const clear = () => repeatListeningStore.set({ artists: [], songs: [], playlists: [] });
let identity = '', channel = '';
let generation = 0;
const attempted = new Set<string>();
authStore.subscribe(session => {
  const next = authIdentity(session);
  if (next !== identity) { identity = next; generation++; attempted.clear(); clear(); }
});
activeChannelStore.subscribe(profile => {
  const next = profile?.pageId ?? '';
  if (next !== channel) { channel = next; generation++; clear(); }
});

/** One optional background request per signed-in channel per app session. */
export async function warmProfileGreetings(home: HomeSection[]): Promise<void> {
  const session = get(authStore);
  const profile = get(activeChannelStore);
  if (!session || !profile || !identity) return;
  const key = channel;
  if (attempted.has(key)) return;
  // The Home avatar provides YouTube's own-profile endpoint and parameters.
  // Only use the channel id as a fallback when it is an actual UC browse id.
  const target = home.find(section => section.header?.profile)?.header?.profile
    ?? (profile.pageId?.startsWith('UC') ? { browseId: profile.pageId } : undefined);
  const existing = repeatListening(home);
  if (Object.values(existing).some(items => items.length)) {
    attempted.add(key);
    repeatListeningStore.set(existing);
    return;
  }
  if (!target) return;
  attempted.add(key);
  const id = generation;
  const active = getActiveChannel();
  try {
    const page = await getBrowsePage(target.browseId, session, target.params);
    if (id !== generation || authIdentity(get(authStore)) !== authIdentity(session) || active !== getActiveChannel()) return;
    repeatListeningStore.set(repeatListening(page.sections));
  } catch {
    // Greetings are optional. Keep the ordinary lines and do not retry/poll.
  }
}
