<script lang="ts">
  import type { HomeFilter } from '$lib/infra/ytmusic/rawHome';

  export let filters: HomeFilter[] = [];
  export let value: HomeFilter | null = null;
  export let onSelect: (filter: HomeFilter | null) => void;

  let root: HTMLDivElement;
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let overflowing = false;
  let atStart = true;
  let atEnd = true;
  function measure() {
    if (!root || !scroller || !content) return;
    overflowing = content.scrollWidth > root.clientWidth + 2;
    atStart = scroller.scrollLeft <= 2;
    atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
  }
  function watchSize(node: HTMLElement) {
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  function scroll(direction: number) {
    scroller.scrollBy({ left: direction * Math.max(80, scroller.clientWidth * 0.8),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  $: mask = `linear-gradient(to right, ${atStart ? '#000' : 'transparent'}, #000 20px, #000 calc(100% - 20px), ${atEnd ? '#000' : 'transparent'})`;
</script>

<div bind:this={root} use:watchSize class="flex min-w-0 flex-1 items-center gap-3">
  <div bind:this={scroller} use:watchSize onscroll={measure} data-page-scroll-key="home-filters" class="min-w-0 flex-1 overflow-x-hidden touch-pan-y" style:mask-image={mask} aria-label="Home filters">
    <div bind:this={content} use:watchSize class="flex w-max gap-2">
      <button class="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors {!value ? 'bg-white text-black' : 'cherry-nav-button text-zinc-200'}" aria-pressed={!value} onclick={() => onSelect(null)}>All</button>
      {#each filters.filter(filter => filter.params) as filter}
        <button class="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors {value?.params === filter.params ? 'bg-white text-black' : 'cherry-nav-button text-zinc-200'}" aria-pressed={value?.params === filter.params} onclick={() => onSelect(filter)}>{filter.label}</button>
      {/each}
    </div>
  </div>
  {#if overflowing}
    <div class="flex shrink-0 items-center gap-2">
      <button class="cherry-nav-button flex h-8 w-8 items-center justify-center rounded-full text-zinc-200 transition-colors disabled:cursor-default disabled:opacity-30"
        disabled={atStart} aria-label="Scroll filters left" onclick={() => scroll(-1)}><i class="ph ph-caret-left text-xl" aria-hidden="true"></i></button>
      <button class="cherry-nav-button flex h-8 w-8 items-center justify-center rounded-full text-zinc-200 transition-colors disabled:cursor-default disabled:opacity-30"
        disabled={atEnd} aria-label="Scroll filters right" onclick={() => scroll(1)}><i class="ph ph-caret-right text-xl" aria-hidden="true"></i></button>
    </div>
  {/if}
</div>

