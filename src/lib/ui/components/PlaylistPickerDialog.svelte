<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import type { Playlist } from '$lib/core/models';
  import { bestThumbnail } from '$lib/core/models';
  import { addablePlaylistsStore, addablePlaylistsLoading, loadAddablePlaylists } from '$lib/app/services/addablePlaylists';
  import { addTracksTo, createNewPlaylist } from '$lib/app/services/playlistEdit';
  import { closePlaylistPicker, playlistPickerStore } from '$lib/app/services/playlistPicker';

  $: state = $playlistPickerStore;
  $: adding = state.tracks.length > 0;

  let query = '';
  let newName = '';
  let busy = false;

  // Only playlists the user can actually write to are offered.
  $: playlists = $addablePlaylistsStore;
  $: filtered = query.trim()
    ? playlists.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase()))
    : playlists;

  // Load the editable set when the dialog opens (the video ids only fill the
  // menu's "already added" state).
  $: if (state.open) void loadAddablePlaylists(state.tracks.map((t) => t.videoId));

  async function pick(playlist: Playlist): Promise<void> {
    if (busy) return;
    busy = true;
    const ok = await addTracksTo(playlist, state.tracks);
    busy = false;
    if (ok) closePlaylistPicker();
  }

  async function create(): Promise<void> {
    if (busy || !newName.trim()) return;
    busy = true;
    const id = await createNewPlaylist(newName, state.tracks);
    busy = false;
    if (id) {
      newName = '';
      closePlaylistPicker();
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closePlaylistPicker();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if state.open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]"
    role="presentation"
    onclick={closePlaylistPicker}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label={adding ? 'Add to playlist' : 'New playlist'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <header class="flex items-center gap-3 px-5 py-4">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/15 text-lg text-[var(--color-accent2)]"
        >
          <i class={adding ? 'bx bx-list-plus' : 'bx bx-plus'}></i>
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[14px] font-semibold text-white">
            {adding ? 'Add to playlist' : 'New playlist'}
          </h2>
          <p class="truncate text-[11px] text-zinc-500">
            {#if adding}
              {state.tracks.length === 1 ? state.tracks[0].title : `${state.tracks.length} songs`}
            {:else}
              Give it a name to start
            {/if}
          </p>
        </div>
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
          onclick={closePlaylistPicker}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </header>

      <div class="flex items-center gap-2 px-5 pb-4">
        <input
          bind:value={newName}
          placeholder="New playlist name…"
          class="min-w-0 flex-1 rounded-xl border border-transparent bg-white/[0.04] px-3.5 py-2.5 text-[12px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60"
          onkeydown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button
          class="cherry-btn-scrim flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-3.5 py-2.5 text-[12px] font-semibold text-white transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          disabled={busy || !newName.trim()}
          onclick={create}
        >
          <i class="bx bx-plus"></i>
          Create
        </button>
      </div>

      {#if adding}
        <div class="flex items-center justify-between px-5 pb-2 pt-3">
          <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Your playlists
          </span>
          {#if playlists.length > 6}
            <label
              class="flex h-7 items-center gap-1.5 rounded-lg border border-transparent bg-white/[0.04] px-2.5 text-zinc-400"
            >
              <i class="bx bx-search text-sm"></i>
              <input
                bind:value={query}
                placeholder="Filter"
                class="w-24 bg-transparent text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </label>
          {/if}
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {#if $addablePlaylistsLoading && playlists.length === 0}
            <p class="px-3 py-5 text-center text-[12px] text-zinc-500">Loading your playlists…</p>
          {:else if playlists.length === 0}
            <p class="px-3 py-5 text-center text-[12px] text-zinc-500">
              No playlists you can edit yet — name one above.
            </p>
          {:else if filtered.length === 0}
            <p class="px-3 py-5 text-center text-[12px] text-zinc-500">No matches.</p>
          {:else}
            {#each filtered as playlist (playlist.browseId)}
              <button
                class="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                disabled={busy}
                onclick={() => pick(playlist)}
              >
                <span class="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {#if bestThumbnail(playlist.thumbnails, 96)}
                    <img src={bestThumbnail(playlist.thumbnails, 96)} alt="" class="h-full w-full object-cover" />
                  {:else}
                    <span class="flex h-full w-full items-center justify-center text-zinc-600"><i class="bx bx-music text-lg"></i></span>
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] font-medium text-zinc-100">{playlist.title}</span>
                  {#if playlist.trackCount != null}
                    <span class="block text-[10px] text-zinc-500">{playlist.trackCount} songs</span>
                  {/if}
                </span>
                <i
                  class="bx bx-chevron-right shrink-0 text-lg text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"
                ></i>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
