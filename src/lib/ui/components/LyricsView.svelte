<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { lyricHighlight } from '$lib/ui/actions/lyricHighlight';
  import { fly } from '$lib/ui/transitions';
  import { lyricsStore, activeLyricAt, retryLyrics } from '$lib/app/services/lyrics';
  import { playerStore, seekTo } from '$lib/app/services/player';
  import { playerExpanded, expandedPlayerPanel } from '$lib/app/services/layout';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  export let expanded = false;
  export let transparent = false;
  let container: HTMLElement;
  $: data = $lyricsStore.data;
  $: active = activeLyricAt(data, $playerStore.positionSeconds);
  let lastActive = -1;
  let scrollFrame = 0;
  let manualUntil = 0;
  let destroyed = false;
  function onManualScroll(event: Event) {
    if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    manualUntil = Date.now() + 2500;
    cancelAnimationFrame(scrollFrame);
  }
  onDestroy(() => { destroyed = true; cancelAnimationFrame(scrollFrame); });
  $: if (expanded && active !== lastActive) {
    lastActive = active;
    const index = active;
    void tick().then(() => {
      if (destroyed || index !== active || Date.now() < manualUntil) return;
      const line = container?.querySelector<HTMLElement>(`[data-line="${index}"]`);
      if (!line) return;
      cancelAnimationFrame(scrollFrame);
      const target = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2));
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { container.scrollTop = target; return; }
      const start = container.scrollTop;
      const began = performance.now();
      function step(now: number) {
        const t = Math.min(1, Math.max(0, (now - began) / 240));
        container.scrollTop = start + (target - start) * (1 - (1 - t) ** 3);
        scrollFrame = t < 1 ? requestAnimationFrame(step) : 0;
      }
      scrollFrame = requestAnimationFrame(step);
    });
  }
</script>

{#if expanded && $lyricsStore.status === 'loading' && !data}
  <p class="px-4 py-3 text-center text-xs text-zinc-400">Loading lyrics…</p>
{:else if expanded && $lyricsStore.status === 'error'}
  <button class="w-full px-4 py-3 text-center text-xs text-zinc-400 hover:text-white" onclick={retryLyrics}>Couldn’t load lyrics · Retry</button>
{:else if expanded && !data}
  <p class="px-4 py-3 text-center text-xs text-zinc-400">Lyrics aren’t available for this track.</p>
{:else if expanded && data}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions : focusable lyrics viewport supports keyboard scrolling -->
  <div bind:this={container} use:overlayScrollbar={{ userScrollOnly: true }} onwheel={onManualScroll} ontouchmove={onManualScroll} onkeydown={onManualScroll} role="region" aria-label="Lyrics" tabindex="0" class="cherry-overlay-scroll relative min-h-0 w-full flex-1 overflow-y-auto rounded-2xl {transparent ? '' : 'bg-[var(--color-popover)]'} px-6 py-10 text-center">
    {#if !data.synced && $lyricsStore.status === 'ready'}<p class="mb-5 text-xs text-zinc-400">Lyrics · Timing unavailable</p>{/if}
    {#each data.lines as line, index}
      {#if line.startSeconds !== undefined && data.synced}
        <button data-line={index} use:lyricHighlight={index === active} class="block w-full rounded-lg px-2 py-2 text-xl font-bold leading-relaxed sm:text-3xl"
          aria-current={index === active ? 'true' : undefined} onclick={() => seekTo(line.startSeconds!)}>{line.text || '♪'}</button>
      {:else}
        <p class="py-1 text-xl font-semibold leading-relaxed text-zinc-200 sm:text-2xl">{line.text || '\u00a0'}</p>
      {/if}
    {/each}
    {#if data.source}<p class="mt-8 text-[10px] text-zinc-400">{data.source}</p>{/if}
  </div>
{:else if $lyricsStore.status === 'ready' && data}
  <button class="flex w-full items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white" title="Expand lyrics" onclick={() => { expandedPlayerPanel.set('lyrics'); playerExpanded.set(true); }}>
    <i class="bx bx-captions text-base text-[var(--color-accent)]" aria-hidden="true"></i>
    {#key `${$playerStore.track?.videoId}:${active}:${data.synced}`}
      <span in:fly={{ y: 4, duration: 160 }} class="truncate text-sm font-semibold">{data.synced ? (active >= 0 ? data.lines[active].text : '♪') : 'Timing unavailable, Open Lyrics'}</span>
    {/key}
  </button>
{/if}
