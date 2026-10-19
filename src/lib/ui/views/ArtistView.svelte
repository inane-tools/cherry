<script lang="ts">
  import ShelfSkeleton from '$lib/ui/components/ShelfSkeleton.svelte';
  import { fade } from '$lib/ui/transitions';
  import EntityHeader from '$lib/ui/components/EntityHeader.svelte';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { artistMenu } from '$lib/app/services/menus';
  import {
    artistError,
    artistLoading,
    artistPageStore,
    loadArtistPage,
  } from '$lib/app/services/catalog';
  import { pageStore } from '$lib/app/services/navigation';
  import { entriesOf, selectCarouselEntry, playCarouselEntry, openCarouselMenu } from '$lib/app/services/browse';
  import Carousel from '$lib/ui/components/Carousel.svelte';
  import ShelfHeading from '$lib/ui/components/ShelfHeading.svelte';

  $: page = $pageStore;
  $: artist = page.view === 'artist' ? page.entity : null;
  $: data = $artistPageStore;
  $: name = data?.title || artist?.name || '';
  $: thumbnails = data?.thumbnails?.length ? data.thumbnails : (artist?.thumbnails ?? []);
  $: sections = data?.sections ?? [];

  // Load once per artist (Back restores the entity without a reload).
  let loadedId: string | null = null;
  $: if (artist && (artist.browseId ?? '') !== loadedId) {
    loadedId = artist.browseId ?? '';
    void loadArtistPage(artist);
  }
</script>

<div class="mx-auto max-w-[80rem] py-6">
  {#if !artist}
    <p class="text-[13px] text-zinc-500">No artist selected.</p>
  {:else}
    <EntityHeader {thumbnails} banner={data?.banner ?? []} condensed loading={$artistLoading} actions={false} round fallbackIcon="ph-duotone ph-user"
      onContextMenu={(event) => openContextMenu(event, artistMenu({ name, browseId: artist?.browseId, thumbnails }))}>
      <div class="min-w-0">
        <div class="w-fit rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-semibold text-zinc-300">Artist</div>
        <h1 class="mt-2 line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          {name}
        </h1>
        {#if data?.subtitle}<p class="mt-1.5 text-[12px] text-zinc-400">{data.subtitle}</p>{/if}
        {#if data?.description}
          <p class="mt-3 line-clamp-3 max-w-3xl whitespace-pre-line text-[12px] leading-relaxed text-zinc-400" title={data.description}>
            {data.description.slice(0, 700)}{data.description.length > 700 ? '…' : ''}
          </p>
        {/if}
      </div>
    </EntityHeader>

    {#if $artistLoading && sections.length === 0}
      <ShelfSkeleton />
    {:else if $artistError}
      <p class="text-[12px] text-rose-300">{$artistError}</p>
    {:else if sections.length === 0}
      <p class="text-[12px] text-zinc-500">Nothing to show for this artist.</p>
    {:else}
      <div in:fade={{ duration: 160 }}>
      {#each sections as section}
        <section class="mb-8">
          <ShelfHeading {section} />
          <Carousel entries={entriesOf(section)} layout={section.layout ?? 'cards'} rows={section.rows ?? 3} onSelect={(entry) => selectCarouselEntry(section, entry)} onPlay={(entry) => playCarouselEntry(section, entry)} onContextMenu={(event, entry) => openCarouselMenu(section, entry, event)} />
        </section>
      {/each}
      </div>
    {/if}
  {/if}
</div>
