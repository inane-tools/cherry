<script lang="ts">
  import { bestThumbnail, trackDisplayArtists } from '$lib/core/models';
  import {
    loadOpenPlaylist,
    openPlaylistDescription,
    openPlaylistError,
    openPlaylistLoading,
    openPlaylistTracks,
    playlistStore,
  } from '$lib/app/services/playlists';
  import { pageStore } from '$lib/app/services/navigation';
  import { playTracks, playTracksShuffled } from '$lib/app/services/player';
  import { shuffleMode } from '$lib/app/services/queue';
  import { authStore } from '$lib/app/services/auth';
  import { openPlaylistEditor } from '$lib/app/services/playlistEditor';
  import { addablePlaylistsStore } from '$lib/app/services/addablePlaylists';
  import { savePlaylist, unsavePlaylist } from '$lib/app/services/playlistLibrary';
  import TrackRow from '$lib/ui/components/TrackRow.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';

  $: page = $pageStore;
  $: playlist = page.view === 'playlist' ? page.entity : null;
  $: tracks = $openPlaylistTracks;
  $: cover = playlist ? bestThumbnail(playlist.thumbnails, 512) : '';
  $: totalSeconds = tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  $: totalLabel = fmtTotal(totalSeconds);
  // Reference the stores so these recompute when the library/editable sets land.
  $: editableIds = $addablePlaylistsStore;
  $: libraryIds = $playlistStore;
  $: owned = !!playlist && editableIds.some((p) => p.browseId === playlist.browseId);
  $: saved = !!playlist && libraryIds.some((p) => p.browseId === playlist.browseId);
  // Until the editable set loads we cannot tell owned from saved, so offer
  // neither action (never a destructive one).
  $: ownershipLoaded = editableIds.length > 0;

  // Load once per playlist (Back restores the entity without a reload).
  let loadedId: string | null = null;
  $: if (playlist && playlist.browseId !== loadedId) {
    loadedId = playlist.browseId;
    void loadOpenPlaylist(playlist);
  }

  function fmtTotal(seconds: number): string {
    if (seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
  }
</script>

<div class="mx-auto max-w-[80rem] py-6">
  {#if !playlist}
    <p class="text-[13px] text-zinc-500">No playlist selected.</p>
  {:else}
    <header class="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start">
      <div class="h-44 w-44 shrink-0 overflow-hidden rounded-lg bg-white/5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        {#if cover}
          <img src={cover} alt="" class="h-full w-full object-cover" />
        {:else}
          <div class="flex h-full w-full items-center justify-center text-zinc-600">
            <i class="bx bx-music text-5xl"></i>
          </div>
        {/if}
      </div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-zinc-300">Playlist</span>
          <span class="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {#if $openPlaylistLoading && tracks.length === 0}
              <span class="inline-block h-2.5 w-9 animate-pulse rounded bg-white/10 align-middle"></span>
            {:else}
              {tracks.length} songs
            {/if}
          </span>
          {#if totalLabel}
            <span class="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400">{totalLabel}</span>
          {/if}
        </div>
        <h1 class="mt-2 line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          {playlist.title}
        </h1>
        {#if playlist.author}
          <div class="mt-1.5 text-[12px] text-zinc-400">{playlist.author}</div>
        {/if}
        {#if $openPlaylistDescription}
          <p
            class="mt-3 line-clamp-3 max-w-3xl whitespace-pre-line text-[12px] leading-relaxed text-zinc-400"
            title={$openPlaylistDescription}
          >
            {$openPlaylistDescription}
          </p>
        {/if}
        <div class="mt-4 flex items-center gap-2">
          <button
            class="cherry-btn-scrim flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
            disabled={tracks.length === 0}
            onclick={() => playTracks(tracks, 0)}
          >
            <i class="bx bx-play text-xl leading-none"></i>
            Play
          </button>
          <button
            class="cherry-btn-scrim flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-[13px] font-semibold {$shuffleMode
              ? 'text-[var(--color-accent2)]'
              : 'text-zinc-200'} hover:bg-white/10 disabled:opacity-40"
            disabled={tracks.length === 0}
            title="Shuffle play"
            onclick={() => playTracksShuffled(tracks)}
          >
            <i class="bx bx-shuffle text-xl leading-none"></i>
            Shuffle
          </button>
          {#if $authStore}
            {#if owned}
              <button
                class="cherry-btn-scrim flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-white/5 text-lg text-zinc-200 hover:bg-white/10"
                title="Edit playlist details"
                aria-label="Edit playlist"
                onclick={() => openPlaylistEditor(playlist)}
              >
                <i class="bx bx-pencil leading-none"></i>
              </button>
            {:else if ownershipLoaded}
              <button
                class="cherry-btn-scrim flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-white/5 text-lg {saved
                  ? 'text-[var(--color-accent2)]'
                  : 'text-zinc-200'} hover:bg-white/10"
                title={saved ? 'Remove from library' : 'Save to library'}
                aria-label={saved ? 'Remove from library' : 'Save to library'}
                onclick={() => (saved ? unsavePlaylist(playlist) : savePlaylist(playlist))}
              >
                <i class="{saved ? 'bx bxs-bookmark' : 'bx bx-bookmark'} leading-none"></i>
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </header>

    {#if $openPlaylistLoading}
      <TrackListSkeleton rows={9} />
    {:else if $openPlaylistError}
      <p class="text-[12px] text-rose-300">{$openPlaylistError}</p>
    {:else if tracks.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing playable in this playlist.</p>
    {:else}
      <div class="flex items-center gap-3 border-b border-white/5 px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        <span class="w-6 text-center">#</span>
        <span class="flex-1">Title</span>
        <span>Duration</span>
      </div>
      <div class="mt-1 flex flex-col gap-0.5">
        {#each tracks as track, index (track.videoId + index)}
          <TrackRow track={track} index={index} list={tracks} playlist={playlist} onPlay={(_t, i) => playTracks(tracks, i)} />
        {/each}
      </div>
      <p class="mt-4 px-2 text-[11px] text-zinc-600">
        {trackDisplayArtists(tracks[0])} and more — {tracks.length} songs.
      </p>
    {/if}
  {/if}
</div>
