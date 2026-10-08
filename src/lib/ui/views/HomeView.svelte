<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { homeLoading, homeSectionsStore, loadHome } from '$lib/app/services/playlists';
  import { exploreLoading, exploreSectionsStore, loadExplore } from '$lib/app/services/explore';
  import { entriesOf, selectCarouselEntry } from '$lib/app/services/browse';
  import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
  import type { CarouselEntry } from '$lib/ui/components/carouselTypes';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  $: sections = $homeSectionsStore;
  $: explore = $exploreSectionsStore;
  // Sections YouTube serves that we deliberately don't render: "Listen together"
  // is a row of 24/7 stations.
  const HIDDEN_SECTIONS = /listen together|station/i;
  // "Listen again" is the hero when present; otherwise the first section that
  // has anything to show.
  $: heroSection =
    sections.find((s) => !HIDDEN_SECTIONS.test(s.title) && /listen again/i.test(s.title)) ??
    sections.find((s) => !HIDDEN_SECTIONS.test(s.title) && (s.cards.length > 0 || s.songs.length > 0));
  $: restSections = sections.filter((s) => s !== heroSection && !HIDDEN_SECTIONS.test(s.title));

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

  // Explore is loaded lazily — only once its section scrolls near the viewport —
  // so it never competes with the startup home/library fetches (and never fires
  // before the brand channel is resolved). An action (not onMount) so it also
  // attaches when the section appears after signing in.
  function lazyExplore(node: HTMLElement) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        void loadExplore();
        io.disconnect();
      },
      { rootMargin: '600px' },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

<div class="mx-auto max-w-[100rem] pb-6">
  {#if !$authStore}
    <!-- App overlays a full-window AuthGate when signed out; nothing to render. -->
  {:else}
    <h1 class="my-6 text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">
      {greet}{firstName ? `, ${firstName}` : ''}
    </h1>

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
          <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
            {heroSection.title || 'Listen again'}
          </h2>
          <Carousel
            hero
            entries={entriesFor(heroSection)}
            onSelect={(entry) => selectCarouselEntry(heroSection, entry)}
          />
        </section>
      {/if}

      {#each restSections as section}
        {#if entriesFor(section).length > 0}
          <section class="mb-8">
            <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
              {section.title || 'For you'}
            </h2>
            <Carousel entries={entriesFor(section)} onSelect={(entry) => selectCarouselEntry(section, entry)} />
          </section>
        {/if}
      {/each}
    {/if}

    <!-- Explore (formerly its own page) lives under the home feed and loads
         lazily when this sentinel nears the viewport. -->
    <div use:lazyExplore aria-hidden="true"></div>
    {#if explore.length > 0}
      {#each explore as section}
        {#if entriesFor(section).length > 0}
          <section class="mb-8">
            <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
              {section.title || 'Browse'}
            </h2>
            <Carousel entries={entriesFor(section)} onSelect={(entry) => selectCarouselEntry(section, entry)} />
          </section>
        {/if}
      {/each}
    {:else if $exploreLoading}
      <div class="flex flex-wrap gap-3">
        {#each Array.from({ length: 10 }) as _s}
          <div class="h-32 w-48 animate-pulse rounded-lg bg-white/5"></div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
