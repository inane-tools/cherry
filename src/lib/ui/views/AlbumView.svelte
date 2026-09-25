<script lang="ts">
  import { bestThumbnail } from '$lib/core/models';
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
  import TrackRow from '$lib/ui/components/TrackRow.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';

  $: page = $pageStore;
  $: album = page.view === 'album' ? page.entity : null;
  $: data = $albumPageStore;
  $: title = data?.title || album?.title || '';
  $: cover = bestThumbnail(
    data?.thumbnails?.length ? data.thumbnails : (album?.thumbnails ?? []),
    512,
  );

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

<div class="mx-auto max-w-[80rem] pb-6">
  {#if !album}
    <p class="text-[13px] text-zinc-500">No album selected.</p>
  {:else}
    <header class="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
      <div class="h-44 w-44 shrink-0 overflow-hidden rounded-lg bg-white/5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        {#if cover}
          <img src={cover} alt="" class="h-full w-full object-cover" />
        {:else}
          <div class="flex h-full w-full items-center justify-center text-zinc-600">
            <i class="bx bx-album text-5xl"></i>
          </div>
        {/if}
      </div>
      <div class="min-w-0">
        <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Album</div>
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
        <div class="mt-2 text-[12px] text-zinc-400">
          {#if $albumLoading && tracks.length === 0}
            <span class="inline-block h-3 w-24 animate-pulse rounded bg-white/5 align-middle"></span>
          {:else}
            {tracks.length} songs{totalLabel ? ` · ${totalLabel}` : ''}
          {/if}
        </div>
        <div class="mt-4 flex items-center gap-2">
          <button
            class="cherry-btn-scrim flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
            disabled={tracks.length === 0}
            onclick={() => playTracks(tracks, 0)}
          >
            <i class="bx bx-play text-xl"></i>
            Play
          </button>
          <button
            class="cherry-btn-scrim flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[13px] font-semibold {$shuffleMode
              ? 'text-[var(--color-accent2)]'
              : 'text-zinc-200'} hover:bg-white/10 disabled:opacity-40"
            disabled={tracks.length === 0}
            title="Shuffle play"
            onclick={() => playTracksShuffled(tracks)}
          >
            <i class="bx bx-shuffle text-lg"></i>
            Shuffle
          </button>
        </div>
      </div>
    </header>

    {#if $albumLoading && tracks.length === 0}
      <TrackListSkeleton rows={8} />
    {:else if $albumError && tracks.length === 0}
      <p class="text-[12px] text-rose-300">{$albumError}</p>
    {:else if tracks.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing playable in this album.</p>
    {:else}
      <div class="flex items-center gap-3 border-b border-white/5 px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        <span class="w-6 text-center">#</span>
        <span class="flex-1">Title</span>
        <span>Duration</span>
      </div>
      <div class="mt-1 flex flex-col gap-0.5">
        {#each tracks as track, index (track.videoId + index)}
          <TrackRow track={track} index={index} list={tracks} onPlay={(_t, i) => playTracks(tracks, i)} />
        {/each}
      </div>
    {/if}
  {/if}
</div>
