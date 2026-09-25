<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import {
    homeLoading,
    homeSectionsStore,
    loadHome,
    openPlaylist,
    playlistStore,
  } from '$lib/app/services/playlists';
  import { entriesOf, selectCarouselEntry } from '$lib/app/services/browse';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { playlistMenu } from '$lib/app/services/menus';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  $: sections = $homeSectionsStore;
  // Sections YouTube serves that we deliberately don't render: "Listen together"
  // is a row of 24/7 stations (our own playlists live in the grid at the end).
  const HIDDEN_SECTIONS = /listen together|station/i;
  // "Listen again" is the hero when present; otherwise the first section that
  // has anything to show.
  $: heroSection =
    sections.find((s) => !HIDDEN_SECTIONS.test(s.title) && /listen again/i.test(s.title)) ??
    sections.find((s) => !HIDDEN_SECTIONS.test(s.title) && (s.cards.length > 0 || s.songs.length > 0));
  $: restSections = sections.filter((s) => s !== heroSection && !HIDDEN_SECTIONS.test(s.title));
  $: playlists = $playlistStore;

  const skeletons = Array.from({ length: 7 });
</script>

<div class="mx-auto max-w-[100rem] pb-6">
  {#if !$authStore}
    <!-- App overlays a full-window AuthGate when signed out; nothing to render. -->
  {:else if $homeLoading && sections.length === 0}
    <div>
      <div class="mb-4 h-7 w-52 animate-pulse rounded bg-white/5"></div>
      <div class="flex gap-3">
        {#each skeletons as _s}
          <div class="w-48 space-y-2 sm:w-56">
            <div class="aspect-square w-full animate-pulse rounded-lg bg-white/5"></div>
            <div class="h-3 w-3/4 animate-pulse rounded bg-white/5"></div>
          </div>
        {/each}
      </div>
    </div>
  {:else if sections.length === 0}
    <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <p class="text-[13px] text-zinc-400">Could not load your home feed.</p>
      <button class="mt-3 text-[12px] text-[var(--color-accent2)] underline" onclick={() => loadHome()}>Retry</button>
    </div>
  {:else}
    {#if heroSection}
      <section class="mb-8">
        <h2 class="mb-4 text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">
          {heroSection.title || 'Listen again'}
        </h2>
        <Carousel
          hero
          entries={entriesOf(heroSection)}
          onSelect={(entry) => selectCarouselEntry(heroSection, entry)}
        />
      </section>
    {/if}

    {#each restSections as section}
      <section class="mb-8">
        <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
          {section.title || 'For you'}
        </h2>
        <Carousel entries={entriesOf(section)} onSelect={(entry) => selectCarouselEntry(section, entry)} />
      </section>
    {/each}
  {/if}

  {#if playlists.length > 0}
    <section class="mt-2">
      <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">Your playlists</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {#each playlists as playlist (playlist.browseId)}
          <button
            class="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-white/5"
            title={playlist.title}
            onclick={() => openPlaylist(playlist)}
            oncontextmenu={(e) => openContextMenu(e, playlistMenu(playlist))}
          >
            <div class="aspect-square w-full overflow-hidden rounded-lg bg-white/5">
              {#if playlist.thumbnails[0]}
                <img
                  src={playlist.thumbnails[0].url}
                  alt=""
                  class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  loading="lazy"
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-zinc-600">
                  <i class="bx bx-music text-2xl"></i>
                </div>
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
    </section>
  {/if}
</div>
