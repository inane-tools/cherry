<script lang="ts">
  import { thumbnailSources } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import type { CarouselEntry } from './carouselTypes';

  export let hero = false;
  export let entries: CarouselEntry[] = [];
  export let onSelect: (entry: CarouselEntry) => void;
  export let onPlay: (entry: CarouselEntry) => void | Promise<void>;
  export let layout: 'cards' | 'songs' | 'buttons' = 'cards';
  export let rows = 3;
  let playingEntry: string | null = null;
  async function play(entry: CarouselEntry): Promise<void> {
    if (playingEntry) return;
    playingEntry = entry.key;
    try { await onPlay(entry); } finally { playingEntry = null; }
  }

  let scroller: HTMLDivElement;
  let atStart = true;
  let atEnd = true;
  function measure(): void {
    if (!scroller) return;
    atStart = scroller.scrollLeft <= 2;
    atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
  }
  $: if (entries) queueMicrotask(measure);
  function watchSize(node: HTMLDivElement) {
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return { destroy: () => observer.disconnect() };
  }

  function scrollByPage(direction: 1 | -1): void {
    if (!scroller) return;
    const first = scroller.firstElementChild as HTMLElement | null;
    const step = (first?.offsetWidth ?? 160) + (layout === 'songs' ? 16 : 12);
    const count = Math.max(1, Math.floor(scroller.clientWidth / step));
    scroller.scrollBy({ left: direction * step * count, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
</script>

<!-- Bleeds to the right window edge (cancelling the content padding) so cards
     scroll all the way out; the left edge stays aligned with the heading. -->
<div class="group/carousel relative -mr-6">
  {#if !atStart || !atEnd}
  <button
    class="absolute right-14 -top-11 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-card)] text-zinc-200 hover:bg-[var(--color-elevated)] disabled:cursor-default disabled:opacity-30"
    disabled={atStart}
    aria-label="Scroll left"
    onclick={() => scrollByPage(-1)}
  >
    <i class="bx bx-chevron-left text-xl"></i>
  </button>
  <button
    class="absolute right-4 -top-11 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-card)] text-zinc-200 hover:bg-[var(--color-elevated)] disabled:cursor-default disabled:opacity-30"
    disabled={atEnd}
    aria-label="Scroll right"
    onclick={() => scrollByPage(1)}
  >
    <i class="bx bx-chevron-right text-xl"></i>
  </button>
  {/if}

  <div bind:this={scroller} use:watchSize onscroll={measure} style:grid-template-rows={layout === 'songs' ? `repeat(${Math.max(1, Math.min(6, rows))}, minmax(0, auto))` : undefined} class="cherry-carousel snap-x snap-proximity overflow-x-auto pb-1 pr-6 {layout === 'songs' ? 'grid grid-flow-col auto-cols-[18rem] gap-x-4 gap-y-2 sm:auto-cols-[21rem]' : 'flex gap-3'}">
    {#each entries as entry (entry.key)}
      {#if layout === 'buttons'}
        <button class="min-w-36 shrink-0 snap-start rounded-lg bg-[var(--color-card)] px-5 py-4 text-left text-[14px] font-semibold text-zinc-100 hover:bg-[var(--color-elevated)]" onclick={() => onSelect(entry)}>{entry.title}</button>
      {:else}
      <div
        class="group relative shrink-0 snap-start rounded-lg p-2 text-left transition-colors hover:bg-white/5 {layout === 'songs' ? 'flex items-center gap-3' : hero
          ? 'w-48 sm:w-56'
          : 'w-36 sm:w-40'}"
      >
        <button class="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent2)]" title={entry.kind === 'song' ? `Play ${entry.title}` : `Open ${entry.title}`} aria-label={entry.kind === 'song' ? `Play ${entry.title}` : `Open ${entry.title}`} onclick={() => onSelect(entry)}></button>
        <div class="pointer-events-none relative overflow-hidden bg-white/5 {entry.round ? 'rounded-full' : 'rounded-lg'} {layout === 'songs' ? 'h-12 w-12 shrink-0' : 'aspect-square w-full'}">
          {#if entry.thumbnails.length > 0}
            <img
              use:artwork={{ urls: thumbnailSources(entry.thumbnails, hero ? 544 : 320) }}
              alt=""
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              loading="lazy"
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-zinc-600">
              <i class="bx bx-music text-2xl"></i>
            </div>
          {/if}
          {#if entry.canPlay !== false}
          <button
            class="pointer-events-auto absolute z-10 flex items-center justify-center text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 {layout === 'songs' ? 'inset-0 h-full w-full rounded-lg bg-black/65' : hero ? 'bottom-2 right-2 h-11 w-11 rounded-full bg-black' : 'bottom-2 right-2 h-8 w-8 rounded-full bg-black'}"
            title={`Play ${entry.title}`} aria-label={`Play ${entry.title}`} disabled={!!playingEntry}
            onclick={() => play(entry)}
          >
            <i class="bx {playingEntry === entry.key ? 'bx-loader-alt animate-spin' : 'bx-play'} {hero ? 'text-2xl' : 'text-lg'}"></i>
          </button>
          {/if}
        </div>
        <div class="pointer-events-none min-w-0 {layout === 'songs' ? 'flex-1' : 'mt-2'}">
        <div class="truncate text-zinc-100 {hero ? 'text-[15px] font-semibold' : 'text-[12px] font-medium'}">
          {entry.title}
        </div>
        {#if entry.subtitle}
          <div class="truncate text-[11px] text-zinc-500">{entry.subtitle}</div>
        {/if}
        </div>
      </div>
      {/if}
    {/each}
  </div>
</div>
