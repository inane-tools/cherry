<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import { openPlaylist, libraryError, libraryLoading, refreshLibrary, playlistStore } from '$lib/app/services/playlists';
  import { requestSearch } from '$lib/app/services/navigation';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { playlistMenu } from '$lib/app/services/menus';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';

  // Search lives here (above the playlists) and stays on top while the list
  // scrolls, since it is a sibling of the scrolling area.
  let query = '';
  function submit(e: SubmitEvent) {
    e.preventDefault();
    requestSearch(query);
  }

  // Hide the bottom fade once the end of the list is reached. (The custom
  // scrollbar itself is handled by the `overlayScrollbar` action.)
  let atBottom = false;
  let listEl: HTMLDivElement | undefined;

  function updateBottom() {
    if (!listEl) return;
    atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 8;
  }

  function onScroll() {
    updateBottom();
  }

  // Re-check when the library (and therefore the list height) changes.
  $: if (listEl) {
    void $playlistStore;
    void $libraryLoading;
    queueMicrotask(updateBottom);
  }
</script>

<aside class="relative flex h-full w-60 shrink-0 flex-col border-r border-white/5 bg-black/20 pt-2 backdrop-blur-[2px]">
  <!-- Search only; Back / Home / Explore live in the top bar. Horizontal
       padding lives on the children so the custom scrollbar can sit right at
       the rail's edge. -->
  <div class="flex shrink-0 items-center px-2">
    <form class="min-w-0 flex-1" onsubmit={submit}>
      <label
        class="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-zinc-400 transition-colors focus-within:border-[var(--color-accent)]/60"
      >
        <button type="submit" class="flex items-center text-base text-zinc-400 hover:text-white" aria-label="Search">
          <i class="bx bx-search"></i>
        </button>
        <input
          bind:value={query}
          class="min-w-0 flex-1 bg-transparent text-left text-[12px] text-zinc-100 outline-none placeholder:text-zinc-500"
          placeholder="Search"
          aria-label="Search YouTube Music"
        />
        {#if query}
          <button type="button" class="flex items-center text-sm text-zinc-500 hover:text-zinc-200" onclick={() => (query = '')} aria-label="Clear search">
            <i class="bx bx-x"></i>
          </button>
        {/if}
      </label>
    </form>
  </div>

  <div
    bind:this={listEl}
    use:overlayScrollbar
    class="cherry-overlay-scroll mt-2 flex min-h-0 flex-1 flex-col gap-0.5 pb-10"
    onscroll={onScroll}
  >
    {#if !$authStore}
      <p class="mx-2 py-2 text-[11px] leading-relaxed text-zinc-600">
        Sign in with YouTube Music in Settings to load your playlists.
      </p>
    {:else if $libraryLoading}
      <p class="mx-2 py-2 text-[11px] text-zinc-600">Loading library…</p>
    {:else if $playlistStore.length === 0}
      <div class="mx-2 py-2 text-[11px] leading-relaxed text-zinc-600">
        <p>{$libraryLoading ? 'Loading library…' : 'No playlists loaded.'}</p>
        {#if $libraryError}<p class="mt-1 text-rose-300/80">{$libraryError}</p>{/if}
        {#if !$libraryLoading}
          <!-- A hard refresh, so Retry re-fetches instead of returning a
               cached/in-flight result (the old Retry did nothing). -->
          <button
            class="mt-1 text-[var(--color-accent2)] underline disabled:opacity-40"
            disabled={$libraryLoading}
            onclick={() => refreshLibrary()}
          >
            Retry
          </button>
        {/if}
      </div>
    {:else}
      {#each $playlistStore as playlist (playlist.browseId)}
        <div class="mx-2 flex items-center">
          <button
            class="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 text-left text-[12px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            title={playlist.title}
            onclick={() => openPlaylist(playlist)}
            oncontextmenu={(e) => openContextMenu(e, playlistMenu(playlist))}
          >
            <span class="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white/5">
              {#if playlist.thumbnails[0]}
                <img src={playlist.thumbnails[0].url} alt="" class="h-full w-full object-cover" loading="lazy" />
              {:else}
                <span class="flex h-full w-full items-center justify-center text-[11px] text-[var(--color-accent2)]">
                  <i class="bx bx-music"></i>
                </span>
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate leading-tight">{playlist.title}</span>
              {#if playlist.author}
                <span class="mt-0.5 block truncate text-[11px] leading-tight text-zinc-500">{playlist.author}</span>
              {/if}
            </span>
          </button>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Fade the bottom of the rail into black so the list trails off; hidden
       once the end of the list is in view. -->
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black via-black/70 to-transparent transition-opacity duration-200 {atBottom
      ? 'opacity-0'
      : 'opacity-100'}"
  ></div>
</aside>
