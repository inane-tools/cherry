<script lang="ts">
  import { artwork } from '$lib/ui/actions/artwork';
  import { thumbnailSources } from '$lib/core/models';
  import { get } from 'svelte/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Album, ArtistRef, Playlist, Track } from '$lib/core/models';
  import { bestThumbnail } from '$lib/core/models';
  import { authStore } from '$lib/app/services/auth';
  import {
    requestSearch,
    searchQuery,
    searchRequest,
    searchResultsStore,
  } from '$lib/app/services/navigation';
  import { playTracks } from '$lib/app/services/player';
  import { SIGN_IN_REQUIRED, announceSignInRequired } from '$lib/app/services/gate';
  import { openAlbum, openArtist } from '$lib/app/services/catalog';
  import { openPlaylist } from '$lib/app/services/playlists';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { playlistMenu } from '$lib/app/services/menus';
  import { parseYouTubeLink, openParsedLink } from '$lib/app/services/openLink';
  import { searchAll } from '$lib/infra/ytmusic/InnertubeClient';
  import TrackRow from '$lib/ui/components/TrackRow.svelte';
  import TrackListSkeleton from '$lib/ui/components/TrackListSkeleton.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';

  export let compact = false;
  export let onClose: () => void = () => {};
  let searchInput: HTMLInputElement;
  let resultPanel: HTMLDivElement;

  function onSearchKey(event: KeyboardEvent): void {
    if (!compact || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const choices = Array.from(resultPanel?.querySelectorAll<HTMLElement>('[role="button"], button') ?? []);
    if (!choices.length) return;
    const active = document.activeElement;
    const index = choices.findIndex((choice) => choice === active);
    event.preventDefault();
    if (event.key === 'ArrowUp' && index <= 0) searchInput.focus();
    else choices[Math.min(choices.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  }
  let q = get(searchQuery);
  $: results = $searchResultsStore;
  let loading = false;
  let error: string | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // Guards against out-of-order responses when queries change quickly.
  let seq = 0;

  // Returning to the search page (Back) keeps the last results; if there are
  // none yet but a query exists, run it.
  onMount(() => {
    if (compact) searchInput?.focus();
    if (q.trim() && !results) void run(q, true);
  });

  async function run(query: string, immediate = false) {
    const text = query.trim();
    clearTimeout(debounce);
    const id = ++seq;
    if (!text) {
      loading = false;
      error = null;
      searchResultsStore.set(null);
      return;
    }
    // A pasted YouTube / YouTube Music link opens that song or playlist rather
    // than searching for the URL text.
    const link = parseYouTubeLink(text);
    if (link) {
      clearTimeout(debounce);
      loading = false;
      error = null;
      void openParsedLink(link);
      return;
    }
    // Gate: anonymous Innertube results cannot be played (PO-token gated), so
    // searching without an account only produces dead results — block it with
    // a single clear message instead.
    if (!$authStore) {
      clearTimeout(debounce);
      loading = false;
      error = SIGN_IN_REQUIRED;
      announceSignInRequired();
      return;
    }
    clearTimeout(debounce);
    const execute = async () => {
      if (id !== seq) return;
      loading = true;
      error = null;
      try {
        const res = await searchAll(text, get(authStore));
        if (id !== seq) return; // a newer search already started
        searchResultsStore.set(res);
        if (
          res.songs.length === 0 &&
          res.albums.length === 0 &&
          res.artists.length === 0 &&
          res.playlists.length === 0
        ) {
          error = `No results for “${text}”.`;
        }
      } catch (e) {
        if (id !== seq) return;
        searchResultsStore.set(null);
        error = e instanceof Error ? e.message : 'Search failed.';
      } finally {
        if (id === seq) loading = false;
      }
    };
    if (immediate) await execute();
    else debounce = setTimeout(() => void execute(), 300);
  }

  // Explicit requests (top bar / Enter) always run, even for a repeat query.
  // Unsubscribed on destroy: the view is re-created on every navigation, so a
  // bare `.subscribe` leaked one listener per visit (each replaying the search).
  const unsubscribeSearch = searchRequest.subscribe((req) => {
    if (!req.id) return;
    q = req.query;
    void run(req.query, true);
  });
  onDestroy(() => {
    ++seq;
    unsubscribeSearch();
    clearTimeout(debounce);
  });

  // Typing in this view refines live.
  function onType() {
    // Keep the shared query in sync so re-opening the popup restores the *last*
    // thing typed, not just the last committed search.
    searchQuery.set(q);
    const text = q;
    requestSearchSilently(text);
  }

  let lastTyped = '';
  function requestSearchSilently(text: string) {
    if (text === lastTyped) return;
    lastTyped = text;
    void run(text);
  }

  function play(list: Track[], i: number) {
    void playTracks(list, i);
    if (compact) onClose();
  }

  function albumCover(album: Album): string {
    return bestThumbnail(album.thumbnails, 320);
  }

  function playlistCover(playlist: Playlist): string {
    return bestThumbnail(playlist.thumbnails, 320);
  }

  function artistAvatar(artist: ArtistRef): string {
    return bestThumbnail(artist.thumbnails ?? [], 64);
  }

  $: songs = results?.songs ?? [];
  $: albums = results?.albums ?? [];
  $: artists = results?.artists ?? [];
  $: playlists = results?.playlists ?? [];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={onSearchKey} class={compact ? 'flex max-h-[76vh] flex-col gap-2' : 'mx-auto max-w-[80rem]'}>
  {#if !$authStore}
    <!-- App overlays a full-window AuthGate when signed out; nothing to render. -->
  {:else}
  <form
    class={compact ? 'flex shrink-0 items-center gap-3 rounded-2xl bg-[var(--color-popover)] px-5 py-4 shadow-[0_16px_48px_rgba(0,0,0,0.4)]' : 'flex items-center gap-2'}
    onsubmit={(e) => {
      e.preventDefault();
      requestSearch(q);
    }}
  >
    {#if compact}<i class="bx bx-search shrink-0 text-2xl text-zinc-500" aria-hidden="true"></i>{/if}
    <div
      class={compact ? 'flex min-w-0 flex-1 items-center gap-3' : 'flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 transition-colors focus-within:border-[var(--color-accent)]/60'}
    >
      <input
        bind:value={q}
        bind:this={searchInput}
        oninput={onType}
        placeholder={compact ? 'Search music or paste a YouTube link' : 'What do you want to listen to?'}
        class="min-w-0 flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-500 {compact ? 'text-[18px]' : 'text-[12px]'}"
        aria-label="Search music"
      />
      {#if q}
        <button
          type="button"
          class="flex items-center text-lg text-zinc-500 hover:text-zinc-200"
          aria-label="Clear"
          onclick={() => {
            q = '';
            searchQuery.set('');
            lastTyped = '';
            void run('');
            searchInput.focus();
          }}
        >
          <i class="bx bx-x"></i>
        </button>
      {/if}
    </div>
    {#if compact}
      <button type="button" onclick={onClose} aria-label="Close search" class="rounded-md bg-white/[0.06] px-1.5 py-1 text-[10px] text-zinc-500 hover:text-white">esc</button>
    {:else}
    <button
      type="submit"
      class="cherry-btn-scrim flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-lg text-white transition-colors hover:bg-[var(--color-accent2)]"
      title="Search"
      aria-label="Search"
    >
      <i class="bx bx-search"></i>
    </button>
    {/if}
  </form>

  {#if !compact || loading || error || results}
  <div bind:this={resultPanel} use:overlayScrollbar class={compact ? 'cherry-overlay-scroll min-h-0 overflow-y-auto rounded-2xl bg-[var(--color-popover)] px-4 pb-4 shadow-[0_16px_48px_rgba(0,0,0,0.4)]' : ''}>
  {#if loading}
    <div class={compact ? 'pt-4' : 'mt-8'}>
      <TrackListSkeleton rows={6} showHeader={false} />
    </div>
  {:else if error}
    <p class="mt-4 text-[12px] text-zinc-500">{error}</p>
  {:else if results}
    {#if songs.length > 0}
      <h2 class="mb-2 text-white {compact ? 'mt-4 text-[12px] font-semibold' : 'mt-8 text-[17px] font-bold tracking-tight sm:text-[19px]'}">
        Songs
      </h2>
      <div class="flex flex-col gap-0.5">
        {#each songs as t, i}
          <TrackRow track={t} index={i} list={songs} onPlay={(_t, ii) => play(songs, ii)} />
        {/each}
      </div>
    {/if}
    {#if artists.length > 0}
      <h2 class="mb-2 text-white {compact ? 'mt-4 text-[12px] font-semibold' : 'mt-8 text-[17px] font-bold tracking-tight sm:text-[19px]'}">
        Artists
      </h2>
      <div class="flex flex-wrap gap-2">
        {#each artists as artist}
          {@const avatar = artistAvatar(artist)}
          <button
            class="flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)] py-1 pl-1 pr-3 text-[12px] text-zinc-300 transition-colors hover:border-[var(--color-accent)]/50 hover:bg-white/5 hover:text-white"
            onclick={() => openArtist(artist)}
          >
            <!-- Fallback sits underneath: if the avatar URL expires the image
                 hides itself and the icon shows through. -->
            <span class="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5 text-zinc-500">
              <i class="bx bx-user text-sm"></i>
              {#if avatar}
                <img
                  src={avatar}
                  alt=""
                  class="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              {/if}
            </span>
            {artist.name}
          </button>
        {/each}
      </div>
    {/if}

    {#if albums.length > 0}
      <h2 class="mb-2 text-white {compact ? 'mt-4 text-[12px] font-semibold' : 'mt-8 text-[17px] font-bold tracking-tight sm:text-[19px]'}">
        Albums
      </h2>
      <div class="grid gap-2 {compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6'}">
        {#each albums as album}
          <button
            class="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-white/5"
            title={album.title}
            onclick={() => openAlbum(album)}
          >
            <div class="aspect-square w-full overflow-hidden rounded-lg bg-white/5">
              {#if albumCover(album)}
                <img
                  use:artwork={{ urls: thumbnailSources(album.thumbnails, 320) }}
                  alt=""
                  class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  loading="lazy"
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-zinc-600"><i class="bx bx-album text-2xl"></i></div>
              {/if}
            </div>
            <div class="min-w-0">
              <div class="truncate text-[12px] font-medium text-zinc-100">{album.title}</div>
              <div class="truncate text-[11px] text-zinc-500">{album.artists.map((a) => a.name).join(', ')}</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    {#if playlists.length > 0}
      <h2 class="mb-2 text-white {compact ? 'mt-4 text-[12px] font-semibold' : 'mt-8 text-[17px] font-bold tracking-tight sm:text-[19px]'}">
        Playlists
      </h2>
      <div class="grid gap-2 {compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8'}">
        {#each playlists as playlist (playlist.browseId)}
          <button
            class="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-white/5"
            title={playlist.title}
            onclick={() => openPlaylist(playlist)}
            oncontextmenu={(e) => openContextMenu(e, playlistMenu(playlist))}
          >
            <div class="aspect-square w-full overflow-hidden rounded-lg bg-white/5">
              {#if playlistCover(playlist)}
                <img
                  use:artwork={{ urls: thumbnailSources(playlist.thumbnails, 320) }}
                  alt=""
                  class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  loading="lazy"
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-zinc-600"><i class="bx bx-music text-2xl"></i></div>
              {/if}
            </div>
            <div class="min-w-0">
              <div class="truncate text-[12px] font-medium text-zinc-100">{playlist.title}</div>
              {#if playlist.author}
                <div class="truncate text-[11px] text-zinc-500">{playlist.author}</div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}


  {/if}
  </div>
  {/if}
  {/if}
</div>
