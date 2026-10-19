<script lang="ts">
  import { fade } from '$lib/ui/transitions';
  import EntityHeader from '$lib/ui/components/EntityHeader.svelte';
  import {
    albumError,
    albumLoading,
    albumPageStore,
    loadAlbumPage,
    openArtist,
  } from '$lib/app/services/catalog';
  import { pageStore } from '$lib/app/services/navigation';
  import { playTracks, playTracksShuffled } from '$lib/app/services/player';
  import { shuffleMode } from '$lib/app/services/queue';
  import TrackList from '$lib/ui/components/TrackList.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { albumMenu } from '$lib/app/services/menus';

  $: page = $pageStore;
  $: album = page.view === 'album' ? page.entity : null;
  $: data = $albumPageStore;
  $: title = data?.title || album?.title || '';
  $: thumbnails = data?.thumbnails?.length ? data.thumbnails : (album?.thumbnails ?? []);

  // Artist/year come from the detail header (the raw subtitle is just
  // "Single • 2026", which would otherwise be mistaken for the artist).
  $: artists = data?.artists?.length ? data.artists : (album?.artists ?? []);
  $: artistLabel = artists.map((a) => a.name).join(', ');
  $: year = data?.year ?? album?.year ?? '';

  // Individual album tracks carry no artists: show the album artist.
  $: tracks = (data?.tracks ?? []).map((track) =>
    track.artists.length === 0 && artists.length > 0 ? { ...track, artists } : track,
  );
  $: totalSeconds = tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  $: totalLabel = fmtTotal(totalSeconds);

  // Load once per album (Back restores the entity without a reload).
  let loadedId: string | null = null;
  $: if (album && album.browseId !== loadedId) {
    loadedId = album.browseId;
    void loadAlbumPage(album);
  }

  function fmtTotal(seconds: number): string {
    if (seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
  }

  function openFirstArtist(): void {
    const artist = artists.find((a) => a.browseId);
    if (artist) openArtist(artist);
  }
</script>

<div class="mx-auto max-w-[80rem] py-6">
  {#if !album}
    <p class="text-[13px] text-zinc-500">No album selected.</p>
  {:else}
    <EntityHeader {thumbnails} condensed loading={$albumLoading} fallbackIcon="ph-duotone ph-vinyl-record"
      onContextMenu={(event) => openContextMenu(event, albumMenu(album))}>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-semibold text-zinc-300">Album</span>
          <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-medium text-zinc-400">
            {#if $albumLoading && tracks.length === 0}
              <span class="inline-block h-2.5 w-9 motion-safe:animate-pulse rounded bg-white/10 align-middle"></span>
            {:else}
              {tracks.length} songs
            {/if}
          </span>
          {#if totalLabel}
            <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-medium text-zinc-400">{totalLabel}</span>
          {/if}
        </div>
        <h1 class="mt-2 line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        {#if artistLabel}
          <div class="mt-1.5 text-[12px] text-zinc-400">
            {#if artists.some((a) => a.browseId)}
              <button class="transition-colors hover:text-white hover:underline" onclick={openFirstArtist}>
                {artistLabel}
              </button>
            {:else}
              {artistLabel}
            {/if}
            {#if year}<span class="text-zinc-600"> · {year}</span>{/if}
          </div>
        {/if}
        <div class="mt-4 flex items-center gap-2">
          <button
            class="cherry-nav-button flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white transition-colors disabled:cursor-default disabled:opacity-40"
            disabled={tracks.length === 0}
            onclick={() => playTracks(tracks, 0)}
          >
            <i class="ph-fill ph-play text-xl leading-none" aria-hidden="true"></i>
            Play
          </button>
          <button
            class="cherry-nav-button flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-xl transition-colors disabled:cursor-default disabled:opacity-40 {$shuffleMode
              ? 'text-[var(--color-accent2)]'
              : 'text-zinc-200'}"
            disabled={tracks.length === 0}
            title="Shuffle play"
            aria-label="Shuffle play"
            onclick={() => playTracksShuffled(tracks)}
          >
            <i class="ph ph-shuffle leading-none" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </EntityHeader>

    {#if $albumLoading && tracks.length === 0}
      <TrackListSkeleton rows={8} />
    {:else if $albumError && tracks.length === 0}
      <p class="text-[12px] text-rose-300">{$albumError}</p>
    {:else if tracks.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing playable in this album.</p>
    {:else}
      <div in:fade={{ duration: 160 }}>
      <div class="flex items-center gap-3 border-b border-white/5 px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        <span class="w-6 text-center">#</span>
        <span class="flex-1">Title</span>
        <span>Duration</span>
      </div>
      <TrackList {tracks} onPlay={(_t, i) => playTracks(tracks, i)} />
      </div>
    {/if}
  {/if}
</div>
