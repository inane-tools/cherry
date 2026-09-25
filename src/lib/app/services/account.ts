// Account + brand-channel context.
//
// A single Google login can own several channels, and YouTube Music answers
// per channel: the library, home feed and recommendations all change with it.
// Without a channel context the API answers for the personal account, which
// can be nearly empty — measured on a real account, playlists went from 1 to
// 25 purely by selecting the right channel.

import { get as getStore, writable } from 'svelte/store';
import type { AccountProfile } from '$lib/core/models';
import { getAccountProfile, getChannels, pickPrimaryChannel, setActiveChannel } from '$lib/infra/ytmusic/InnertubeClient';
import { authStore } from './auth';
import { updateSettings } from './settings';
import { settingsStore } from './settings';

export const channelsStore = writable<AccountProfile[]>([]);
export const activeChannelStore = writable<AccountProfile | null>(null);

let initialized = false;

async function applyChannel(profile: AccountProfile | null): Promise<void> {
  setActiveChannel(profile?.pageId ?? '');
  activeChannelStore.set(profile);
}

/**
 * Establish the channel context once per session:
 *  1. reuse the persisted channel if it still exists,
 *  2. otherwise ask YouTube which channel actually holds a library.
 *
 * Enumeration can transiently come back empty right after signing in, so it is
 * retried; `initialized` is only set once a profile is actually resolved (that
 * is what used to make login take several attempts plus a restart).
 */
export async function initChannel(force = false): Promise<AccountProfile | null> {
  const session = getStore(authStore);
  if (!session) {
    await applyChannel(null);
    channelsStore.set([]);
    initialized = false;
    return null;
  }
  if (initialized && !force && getStore(activeChannelStore)) {
    return getStore(activeChannelStore);
  }

  let channels: AccountProfile[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      channels = await getChannels(session);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[cherry] channel list attempt failed:', e);
      channels = [];
    }
    if (channels.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  if (channels.length === 0) return null;
  channelsStore.set(channels);

  const savedPageId = getStore(settingsStore).channelPageId;
  const saved = savedPageId ? channels.find((c) => c.pageId === savedPageId) : undefined;

  let chosen: AccountProfile | null = saved ?? null;
  if (!chosen) {
    // Auto-detect the channel that owns a real library.
    chosen = (await pickPrimaryChannel(session)) ?? channels.find((c) => c.isChannel) ?? channels[0] ?? null;
    if (chosen?.pageId) await updateSettings({ channelPageId: chosen.pageId });
  }
  if (!chosen) return null;

  await applyChannel(chosen);
  initialized = true;
  return chosen;
}

/** Switch to a different channel and persist the choice. */
export async function selectChannel(pageId: string): Promise<void> {
  const profile = getStore(channelsStore).find((c) => c.pageId === pageId) ?? null;
  await updateSettings({ channelPageId: pageId });
  await applyChannel(profile);
}

/** Re-read the profile for the active channel (used after login). */
export async function refreshActiveProfile(): Promise<AccountProfile | null> {
  const session = getStore(authStore);
  if (!session) return null;
  const profile = await getAccountProfile(session);
  activeChannelStore.set(profile);
  return profile;
}
