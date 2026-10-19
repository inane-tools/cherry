<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import { homeLoading, homeSectionsStore, homeContinuationStore, homeMoreLoading, homeMoreError, homeFiltersStore, homeFilterStore, selectHomeFilter, loadHome, loadMoreHome, refreshHome } from '$lib/app/services/playlists';
  import { entriesOf, selectCarouselEntry, playCarouselEntry, openCarouselMenu } from '$lib/app/services/browse';
  import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
  import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
  import Carousel from '$lib/ui/components/Carousel.svelte';
  import ShelfHeading from '$lib/ui/components/ShelfHeading.svelte';
  import ShelfSkeleton from '$lib/ui/components/ShelfSkeleton.svelte';
  import { fade } from '$lib/ui/transitions';
  import HomeFilters from '$lib/ui/components/HomeFilters.svelte';

  $: sections = $homeSectionsStore;
  $: heroSection = sections.find(s => s.cards.length > 0 || s.songs.length > 0);
  $: restSections = sections.filter(s => s !== heroSection);

  // The home feed can surface the user's own playlists; hide any that report no
  // songs so the front page never shows an empty playlist.
  const EMPTY_PLAYLIST = /\b0\s*(songs?|tracks?|videos?)\b|^\s*no\s+(songs?|tracks?|videos?)\s*$/i;
  function entriesFor(section: HomeSection): CarouselEntry[] {
    return entriesOf(section).filter(
      (entry) => !(entry.kind === 'card' && EMPTY_PLAYLIST.test(entry.subtitle ?? '')),
    );
  }



  function lazyHomeMore(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !$homeMoreError) {
        observer.disconnect();
        void loadMoreHome();
      }
    }, { rootMargin: '400px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

<div class="mx-auto max-w-[100rem] pb-6">
  {#if !$authStore}
    <!-- App overlays a full-window AuthGate when signed out; nothing to render. -->
  {:else}
    <h1 class="sr-only">Home</h1>
    <div class="my-5 flex items-center gap-3">
    {#if $homeFiltersStore.length}
      <HomeFilters filters={$homeFiltersStore} value={$homeFilterStore} onSelect={selectHomeFilter} />
    {:else}<div class="flex-1"></div>{/if}
      <button class="cherry-nav-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-200 transition-colors disabled:cursor-default disabled:opacity-30" disabled={$homeLoading || $homeMoreLoading} title="Refresh recommendations" aria-label="Refresh recommendations" onclick={refreshHome}><i class="ph ph-arrow-clockwise text-xl" aria-hidden="true"></i></button>
    </div>

    {#if $homeLoading && sections.length === 0}
      <ShelfSkeleton hero />
    {:else if sections.length === 0}
      <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p class="text-[13px] text-zinc-400">Could not load your home feed.</p>
        <button class="mt-3 text-[12px] text-[var(--color-accent2)] underline" onclick={() => loadHome()}>Retry</button>
      </div>
    {:else}
      <div in:fade={{ duration: 160 }}>
      {#if heroSection && entriesFor(heroSection).length > 0}
        <section class="mb-8">
          <ShelfHeading section={heroSection} large />
          <Carousel
            hero
            scrollKey={`home:${heroSection.title}:${entriesFor(heroSection)[0]?.key ?? ''}`}
            entries={entriesFor(heroSection)}
            onSelect={(entry) => selectCarouselEntry(heroSection, entry)}
            onPlay={(entry) => playCarouselEntry(heroSection, entry)}
            onContextMenu={(event, entry) => openCarouselMenu(heroSection, entry, event)}
            layout={heroSection.layout ?? 'cards'}
            rows={heroSection.rows ?? 3}
          />
        </section>
      {/if}

      {#each restSections as section}
        {#if entriesFor(section).length > 0}
          <section class="mb-8">
            <ShelfHeading {section} />
            <Carousel scrollKey={`home:${section.title}:${entriesFor(section)[0]?.key ?? ''}`} entries={entriesFor(section)} layout={section.layout ?? 'cards'} rows={section.rows ?? 3} onSelect={(entry) => selectCarouselEntry(section, entry)} onPlay={(entry) => playCarouselEntry(section, entry)} onContextMenu={(event, entry) => openCarouselMenu(section, entry, event)} />
          </section>
        {/if}
      {/each}
      </div>
    {/if}

    {#if $homeContinuationStore}
      {#key $homeContinuationStore}<div use:lazyHomeMore aria-hidden="true"></div>{/key}
      <div class="flex flex-col items-center gap-2 py-6">
        {#if $homeMoreError}<p class="text-[12px] text-zinc-400">{$homeMoreError}</p>{/if}
        <button class="rounded-full bg-white/5 px-5 py-2 text-[12px] text-zinc-200 hover:bg-white/10 disabled:opacity-40" disabled={$homeMoreLoading} onclick={loadMoreHome}>{$homeMoreLoading ? 'Loading recommendations…' : $homeMoreError ? 'Try again' : 'More recommendations'}</button>
      </div>
    {/if}
  {/if}
</div>
