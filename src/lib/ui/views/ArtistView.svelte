<script lang="ts">
  import { bestThumbnail } from '$lib/core/models';
  import {
    artistError,
    artistLoading,
    artistPageStore,
    loadArtistPage,
  } from '$lib/app/services/catalog';
  import { pageStore } from '$lib/app/services/navigation';
  import { entriesOf, selectCarouselEntry } from '$lib/app/services/browse';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  $: page = $pageStore;
  $: artist = page.view === 'artist' ? page.entity : null;
  $: data = $artistPageStore;
  $: name = data?.title || artist?.name || '';
  $: avatar = bestThumbnail(data?.thumbnails ?? [], 512);
  $: sections = data?.sections ?? [];

  // Load once per artist (Back restores the entity without a reload).
  let loadedId: string | null = null;
  $: if (artist && (artist.browseId ?? '') !== loadedId) {
    loadedId = artist.browseId ?? '';
    void loadArtistPage(artist);
  }
</script>

<div class="mx-auto max-w-[100rem] py-6">
  {#if !artist}
    <p class="text-[13px] text-zinc-500">No artist selected.</p>
  {:else}
    <header class="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-start">
      <div class="h-40 w-40 shrink-0 overflow-hidden rounded-full bg-white/5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        {#if avatar}
          <img src={avatar} alt="" class="h-full w-full object-cover" />
        {:else}
          <div class="flex h-full w-full items-center justify-center text-zinc-600">
            <i class="bx bx-user text-5xl"></i>
          </div>
        {/if}
      </div>
      <div class="min-w-0">
        {#if data?.subtitle}
          <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">{data.subtitle}</div>
        {/if}
        <h1 class="mt-1 line-clamp-2 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
          {name}
        </h1>
        {#if data?.description}
          <p class="mt-3 max-w-2xl whitespace-pre-line text-[12px] leading-relaxed text-zinc-400">
            {data.description.slice(0, 700)}{data.description.length > 700 ? '…' : ''}
          </p>
        {/if}
      </div>
    </header>

    {#if $artistLoading && sections.length === 0}
      <p class="text-[12px] text-zinc-500">Loading…</p>
    {:else if $artistError}
      <p class="text-[12px] text-rose-300">{$artistError}</p>
    {:else if sections.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing to show for this artist.</p>
    {:else}
      {#each sections as section}
        <section class="mb-8">
          <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
            {section.title || 'More'}
          </h2>
          <Carousel entries={entriesOf(section)} onSelect={(entry) => selectCarouselEntry(section, entry)} />
        </section>
      {/each}
    {/if}
  {/if}
</div>
