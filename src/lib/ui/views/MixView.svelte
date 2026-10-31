<script lang="ts">
  import { onDestroy } from 'svelte';
  import { pageStore } from '$lib/app/services/navigation';
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { authIdentity } from '$lib/infra/ytmusic/authContext';
  import { getActiveChannel, getRadioPage } from '$lib/infra/ytmusic/InnertubeClient';
  import { playRadio, type RadioPage } from '$lib/app/services/radio';
  import type { AuthSession, RadioEndpoint } from '$lib/core/models';
  import EntityHeader from '$lib/ui/components/EntityHeader.svelte';
  import TrackList from '$lib/ui/components/TrackList.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';
  import { fade } from '$lib/ui/transitions';

  $: mix = $pageStore.view === 'browse' && $pageStore.entity.kind === 'mix' ? $pageStore.entity : null;
  $: key = JSON.stringify([mix?.endpoint, authIdentity($authStore), $activeChannelStore?.pageId]);
  let loadedKey = '';
  let generation = 0;
  let loading = false;
  let error = '';
  let data: RadioPage | null = null;
  let loadedAccount = '', loadedChannel = '';
  let loadingMore = false;
  const tokens = new Set<string>();
  $: if (mix?.endpoint && key !== loadedKey) { loadedKey = key; void load(mix.endpoint, $authStore); }
  $: tracks = data?.tracks ?? [];
  $: thumbnails = mix?.thumbnails?.length ? mix.thumbnails : (tracks[0]?.thumbnails ?? []);
  $: source = mix?.endpoint ? { kind: 'mix' as const, title: mix.title, endpoint: mix.endpoint } : null;
  onDestroy(() => { generation++; });

  async function load(endpoint: RadioEndpoint, session: AuthSession | null) {
    const id = ++generation;
    loading = true; loadingMore = false; error = ''; data = null; tokens.clear();
    loadedAccount = authIdentity(session); loadedChannel = getActiveChannel();
    try { const page = await getRadioPage(endpoint, session); if (id === generation) data = page; }
    catch { if (id === generation) error = 'Could not load this mix. Try again.'; }
    finally { if (id === generation) loading = false; }
  }
  async function more() {
    if (!mix?.endpoint || !data?.continuation || loadingMore) return;
    const id = generation, token = data.continuation;
    if (tokens.has(token)) return;
    loadingMore = true; error = '';
    try {
      const next = await getRadioPage(data.endpoint ?? mix.endpoint, $authStore, token);
      if (id !== generation || !data) return;
      tokens.add(token);
      const seen = new Set(data.tracks.map(track => track.videoId));
      data = { ...data, tracks: [...data.tracks, ...next.tracks.filter(track => !seen.has(track.videoId))],
        continuation: next.continuation && !tokens.has(next.continuation) ? next.continuation : undefined };
    } catch { if (id === generation) error = 'Could not load more mix tracks. Try again.'; }
    finally { if (id === generation) loadingMore = false; }
  }
  function play(index = 0) {
    if (mix?.endpoint && data) void playRadio(mix.endpoint, { title: mix.title, startAt: index,
      initial: { page: data, account: loadedAccount, channel: loadedChannel } });
  }
</script>

<div class="mx-auto max-w-[80rem] py-6">
  {#if mix}
    <EntityHeader {thumbnails} condensed {loading} fallbackIcon="ph-duotone ph-play-circle">
      <div class="min-w-0">
        <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-semibold text-zinc-300">Mix</span>
        <h1 class="mt-2 line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">{mix.title}</h1>
        <p class="mt-1.5 text-[12px] text-zinc-400">{tracks.length ? `${tracks.length} songs loaded` : 'Made for you'}</p>
        <button class="cherry-nav-button mt-5 flex h-[42px] items-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white disabled:opacity-40" disabled={!tracks.length} onclick={() => play()}>
          <i class="ph-fill ph-play text-xl" aria-hidden="true"></i>Play
        </button>
      </div>
    </EntityHeader>
    {#if loading}<TrackListSkeleton rows={8} />
    {:else if tracks.length}
      <div in:fade={{ duration: 160 }}><TrackList {tracks} {source} onPlay={(_track, index) => play(index)} /></div>
    {/if}
    {#if error}<p role="alert" class="mt-4 text-[12px] text-zinc-400">{error}</p>{/if}
    {#if data?.continuation}<button class="cherry-nav-button mt-4 rounded-full px-5 py-2 text-[12px] text-zinc-300 disabled:opacity-40" disabled={loadingMore} onclick={more}>{loadingMore ? 'Loading…' : 'More'}</button>
    {:else if error && !tracks.length}<button class="cherry-nav-button mt-4 rounded-full px-5 py-2 text-[12px] text-zinc-300" onclick={() => mix?.endpoint && load(mix.endpoint, $authStore)}>Try again</button>{/if}
  {/if}
</div>
