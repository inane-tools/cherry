<script lang="ts">
  import { bestThumbnail } from '$lib/core/models';
  import type { CarouselEntry } from './carouselTypes';

  export let hero = false;
  export let entries: CarouselEntry[] = [];
  export let onSelect: (entry: CarouselEntry) => void;

  let scroller: HTMLDivElement;

  function scrollByPage(direction: 1 | -1): void {
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.85, behavior: 'smooth' });
  }
</script>

<!-- Bleeds to the right window edge (cancelling the content padding) so cards
     scroll all the way out; the left edge stays aligned with the heading. -->
<div class="group/carousel relative -mr-6">
  <button
    class="absolute left-1 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/70 text-zinc-200 opacity-0 backdrop-blur transition-opacity hover:bg-black/90 group-hover/carousel:opacity-100"
    aria-label="Scroll left"
    onclick={() => scrollByPage(-1)}
  >
    <i class="bx bx-chevron-left text-xl"></i>
  </button>
  <button
    class="absolute right-1 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/70 text-zinc-200 opacity-0 backdrop-blur transition-opacity hover:bg-black/90 group-hover/carousel:opacity-100"
    aria-label="Scroll right"
    onclick={() => scrollByPage(1)}
  >
    <i class="bx bx-chevron-right text-xl"></i>
  </button>

  <div bind:this={scroller} class="cherry-carousel flex gap-3 overflow-x-auto pb-1">
    {#each entries as entry (entry.key)}
      <button
        class="group shrink-0 rounded-lg p-2 text-left transition-colors hover:bg-white/5 {hero
          ? 'w-48 sm:w-56'
          : 'w-36 sm:w-40'}"
        title={entry.kind === 'song' ? `Play ${entry.title}` : `Open ${entry.title}`}
        onclick={() => onSelect(entry)}
      >
        <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-white/5">
          {#if entry.thumbnails.length > 0}
            <img
              src={bestThumbnail(entry.thumbnails, hero ? 544 : 320)}
              alt=""
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              loading="lazy"
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-zinc-600">
              <i class="bx bx-music text-2xl"></i>
            </div>
          {/if}
          <span
            class="absolute bottom-2 right-2 flex items-center justify-center rounded-full bg-black/75 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 {hero
              ? 'h-11 w-11'
              : 'h-8 w-8'}"
          >
            <i class="bx bx-play {hero ? 'text-2xl' : 'text-lg'}"></i>
          </span>
        </div>
        <div class="mt-2 truncate text-zinc-100 {hero ? 'text-[15px] font-semibold' : 'text-[12px] font-medium'}">
          {entry.title}
        </div>
        {#if entry.subtitle}
          <div class="truncate text-[11px] text-zinc-500">{entry.subtitle}</div>
        {/if}
      </button>
    {/each}
  </div>
</div>
