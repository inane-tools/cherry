<script lang="ts">
  import { onMount } from 'svelte';
  import { exploreLoading, exploreSectionsStore, loadExplore } from '$lib/app/services/explore';
  import { entriesOf, selectCarouselEntry } from '$lib/app/services/browse';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  $: sections = $exploreSectionsStore;

  onMount(() => {
    void loadExplore();
  });
</script>

<div class="mx-auto max-w-[100rem] pb-6">
  <h1 class="mb-6 text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">Explore</h1>

  {#if $exploreLoading && sections.length === 0}
    <div class="flex flex-wrap gap-3">
      {#each Array.from({ length: 10 }) as _s}
        <div class="h-32 w-48 animate-pulse rounded-lg bg-white/5"></div>
      {/each}
    </div>
  {:else if sections.length === 0}
    <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <p class="text-[13px] text-zinc-400">Could not load Explore.</p>
      <button class="mt-3 text-[12px] text-[var(--color-accent2)] underline" onclick={() => loadExplore()}>
        Retry
      </button>
    </div>
  {:else}
    {#each sections as section}
      <section class="mb-8">
        <h2 class="mb-3 text-[17px] font-bold tracking-tight text-white sm:text-[19px]">
          {section.title || 'Browse'}
        </h2>
        <Carousel entries={entriesOf(section)} onSelect={(entry) => selectCarouselEntry(section, entry)} />
      </section>
    {/each}
  {/if}
</div>
