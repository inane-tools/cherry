<script lang="ts">
  import { fade } from '$lib/ui/transitions';
  import { trackDisplayArtists } from '$lib/core/models';
  import EntityHeader from '$lib/ui/components/EntityHeader.svelte';
  import {
    loadOpenPlaylist,
    openPlaylistDescription,
    openPlaylistError,
    openPlaylistLoading,
    openPlaylistHeaderLoading,
    openPlaylistTracks,
    playlistStore,
  } from '$lib/app/services/playlists';
  import { pageStore } from '$lib/app/services/navigation';
  import { playTracks, playTracksShuffled } from '$lib/app/services/player';
  import { currentItem, shuffleMode } from '$lib/app/services/queue';
  import { playingTrackIndex } from '$lib/core/playingTrackIndex';
  import { authStore } from '$lib/app/services/auth';
  import { openPlaylistEditor } from '$lib/app/services/playlistEditor';
  import { addablePlaylistsStore } from '$lib/app/services/addablePlaylists';
  import { savePlaylist, unsavePlaylist } from '$lib/app/services/playlistLibrary';
  import { requestPlaylistDeletion } from '$lib/app/services/playlistDelete';
  import { playlistMenu } from '$lib/app/services/menus';
  import { queueCollection } from '$lib/app/services/queueActions';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import TrackList from '$lib/ui/components/TrackList.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';

  $: page = $pageStore;
  $: playlist = page.view === 'playlist' ? page.entity : null;
  $: tracks = $openPlaylistTracks;
  $: currentTrackIndex = playingTrackIndex(tracks, $currentItem);
  $: artworkPlaylist = $playlistStore.find((p) => p.browseId === playlist?.browseId) ?? playlist;
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

  function openPlaylistActions(event: MouseEvent): void {
    if (!playlist || !owned || !$authStore) return;
    const selected = playlist;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    event.stopPropagation();
    openContextMenu(new MouseEvent('click', { clientX: bounds.left, clientY: bounds.bottom + 4 }), [
      { label: 'Add to queue', icon: 'ph ph-list-plus', action: () => queueCollection(selected) },
      { label: 'Edit playlist…', icon: 'ph ph-pencil-simple', action: () => openPlaylistEditor(selected) },
      { label: 'Delete playlist…', icon: 'ph ph-trash', destructive: true, action: () => requestPlaylistDeletion(selected) },
    ]);
  }
</script>

<div class="mx-auto max-w-[80rem] py-6">
  {#if !playlist}
    <p class="text-[13px] text-zinc-500">No playlist selected.</p>
  {:else}
    <EntityHeader thumbnails={artworkPlaylist?.thumbnails ?? []} condensed loading={$openPlaylistHeaderLoading}
      onContextMenu={(event) => openContextMenu(event, playlistMenu(playlist))}>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-semibold text-zinc-300">Playlist</span>
          <span class="rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-medium text-zinc-400">
            {#if $openPlaylistLoading && tracks.length === 0}
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
          {#if $authStore}
            {#if owned}
              <button
                class="cherry-nav-button flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-lg text-zinc-200 transition-colors"
                title="Playlist actions"
                aria-label="Playlist actions"
                aria-haspopup="menu"
                onclick={openPlaylistActions}
              >
                <i class="ph ph-dots-three leading-none"></i>
              </button>
            {:else if ownershipLoaded}
              <button
                class="cherry-btn-scrim flex h-[42px] w-[42px] items-center justify-center rounded-full bg-white/5 text-lg {saved
                  ? 'text-[var(--color-accent2)]'
                  : 'text-zinc-200'} hover:bg-white/10"
                title={saved ? 'Remove from library' : 'Save to library'}
                aria-label={saved ? 'Remove from library' : 'Save to library'}
                onclick={() => (saved ? unsavePlaylist(playlist) : savePlaylist(playlist))}
              >
                <i class="{saved ? 'ph-fill ph-bookmark-simple' : 'ph ph-bookmark-simple'} leading-none"></i>
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </EntityHeader>

    {#if $openPlaylistLoading}
      <TrackListSkeleton rows={9} />
    {:else if $openPlaylistError}
      <p class="text-[12px] text-rose-300">{$openPlaylistError}</p>
    {:else if tracks.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing playable in this playlist.</p>
    {:else}
      <div in:fade={{ duration: 160 }}>
      <div class="flex items-center gap-3 border-b border-white/5 px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        <span class="w-6 text-center">#</span>
        <span class="flex-1">Title</span>
        <span>Duration</span>
      </div>
      <TrackList {tracks} {playlist} currentIndex={currentTrackIndex} onPlay={(_t, i) => playTracks(tracks, i)} />
      <p class="mt-4 px-2 text-[11px] text-zinc-600">
        {trackDisplayArtists(tracks[0])} and more — {tracks.length} songs.
      </p>
      </div>
    {/if}
  {/if}
</div>
