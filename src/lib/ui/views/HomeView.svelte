<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { homeLoading, homeSectionsStore, homeContinuationStore, homeMoreLoading, homeMoreError, homeFiltersStore, homeFilterStore, selectHomeFilter, loadHome, loadMoreHome, refreshHome } from '$lib/app/services/playlists';
  import { entriesOf, selectCarouselEntry, playCarouselEntry } from '$lib/app/services/browse';
  import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
  import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  $: sections = $homeSectionsStore;
  $: heroSection = sections.find(s => s.cards.length > 0 || s.songs.length > 0);
  $: restSections = sections.filter(s => s !== heroSection);

  // Skeleton sizes mirror the real carousels: a hero row of wide cards plus a
  // couple of ordinary sections of smaller cards.
  const heroSkeletons = Array.from({ length: 5 });
  const cardSkeletons = Array.from({ length: 8 });
  const sectionSkeletons = Array.from({ length: 2 });

  // The home feed can surface the user's own playlists; hide any that report no
  // songs so the front page never shows an empty playlist.
  const EMPTY_PLAYLIST = /\b0\s*(songs?|tracks?|videos?)\b|^\s*no\s+(songs?|tracks?|videos?)\s*$/i;
  function entriesFor(section: HomeSection): CarouselEntry[] {
    return entriesOf(section).filter(
      (entry) => !(entry.kind === 'card' && EMPTY_PLAYLIST.test(entry.subtitle ?? '')),
    );
  }

  function greeting(): string {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }
  $: greet = greeting();
  $: firstName = ($activeChannelStore?.name ?? '').trim().split(/\s+/)[0] ?? '';


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
    <div class="my-6 flex items-center justify-between gap-4">
    <h1 class="min-w-0 flex-1 break-words text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">
      {greet}{firstName ? `, ${firstName}` : ''}
    </h1>
    <div class="flex shrink-0 items-center gap-2">
      <button class="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={$homeLoading || $homeMoreLoading} title="Refresh recommendations" aria-label="Refresh recommendations" onclick={refreshHome}><i class="bx bx-refresh text-xl"></i></button>
    </div>
    </div>

    {#if $homeFiltersStore.length}
      <div class="cherry-carousel -mr-6 mb-7 flex gap-2 overflow-x-auto pr-6">
        <button class="shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold {!$homeFilterStore ? 'bg-white text-black' : 'bg-white/5 text-zinc-200 hover:bg-white/10'}" aria-pressed={!$homeFilterStore} onclick={() => selectHomeFilter(null)}>All</button>
        {#each $homeFiltersStore.filter((filter) => filter.params) as filter}
          <button class="shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold {$homeFilterStore?.params === filter.params ? 'bg-white text-black' : 'bg-white/5 text-zinc-200 hover:bg-white/10'}" aria-pressed={$homeFilterStore?.params === filter.params} onclick={() => selectHomeFilter(filter)}>{filter.label}</button>
        {/each}
      </div>
    {/if}

    {#if $homeLoading && sections.length === 0}
      <div>
        <!-- Hero section (wide cards, like "Listen again"). -->
        <section class="mb-8">
          <div class="mb-3 h-5 w-40 animate-pulse rounded bg-white/5"></div>
          <div class="flex gap-3 overflow-hidden">
            {#each heroSkeletons as _s}
              <div class="w-48 shrink-0 sm:w-56">
                <div class="aspect-square w-full animate-pulse rounded-lg bg-white/5"></div>
                <div class="mt-2 h-3.5 w-3/4 animate-pulse rounded bg-white/5"></div>
                <div class="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-white/5/60"></div>
              </div>
            {/each}
          </div>
        </section>

        <!-- A couple of ordinary sections (smaller cards). -->
        {#each sectionSkeletons as _section, i (i)}
          <section class="mb-8">
            <div class="mb-3 h-5 w-32 animate-pulse rounded bg-white/5"></div>
            <div class="flex gap-3 overflow-hidden">
              {#each cardSkeletons as _s}
                <div class="w-36 shrink-0 sm:w-40">
                  <div class="aspect-square w-full animate-pulse rounded-lg bg-white/5"></div>
                  <div class="mt-2 h-3 w-3/4 animate-pulse rounded bg-white/5"></div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else if sections.length === 0}
      <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p class="text-[13px] text-zinc-400">Could not load your home feed.</p>
        <button class="mt-3 text-[12px] text-[var(--color-accent2)] underline" onclick={() => loadHome()}>Retry</button>
      </div>
    {:else}
      {#if heroSection && entriesFor(heroSection).length > 0}
        <section class="mb-8">
          <h2 class="mb-3 pr-24 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
            {heroSection.title || 'Listen again'}
          </h2>
          <Carousel
            hero
            entries={entriesFor(heroSection)}
            onSelect={(entry) => selectCarouselEntry(heroSection, entry)}
            onPlay={(entry) => playCarouselEntry(heroSection, entry)}
            layout={heroSection.layout ?? 'cards'}
            rows={heroSection.rows ?? 3}
          />
        </section>
      {/if}

      {#each restSections as section}
        {#if entriesFor(section).length > 0}
          <section class="mb-8">
            <h2 class="mb-3 pr-24 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
              {section.title || 'For you'}
            </h2>
            <Carousel entries={entriesFor(section)} layout={section.layout ?? 'cards'} rows={section.rows ?? 3} onSelect={(entry) => selectCarouselEntry(section, entry)} onPlay={(entry) => playCarouselEntry(section, entry)} />
          </section>
        {/if}
      {/each}
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
