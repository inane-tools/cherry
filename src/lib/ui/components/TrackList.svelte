<script lang="ts">
  import { tick } from 'svelte';
  import type { Playlist, Track } from '$lib/core/models';
  import { virtualRows, rowIndexes } from '$lib/ui/actions/virtualRows';
  import TrackRow from './TrackRow.svelte';

  export let tracks: Track[];
  export let playlist: Playlist | undefined = undefined;
  export let currentIndex: number | undefined = undefined;
  export let onPlay: (track: Track, index: number) => void;
  const rowHeight = 54; // 52px row plus the existing 2px gap.
  let start = 0, end = 20, focused = -1;
  let list: HTMLDivElement;
  $: virtual = tracks.length > 80;
  $: visible = rowIndexes(tracks.length, start, end, focused);

  function onRange(nextStart: number, nextEnd: number) {
    if (start !== nextStart) start = nextStart;
    if (end !== nextEnd) end = nextEnd;
  }
  function onFocus(event: FocusEvent) {
    const row = (event.target as Element)?.closest<HTMLElement>('[data-track-index]');
    focused = row ? Number(row.dataset.trackIndex) : -1;
  }
  function onBlur(event: FocusEvent) {
    if (!list.contains(event.relatedTarget as Node)) focused = -1;
  }
  async function onKey(event: KeyboardEvent) {
    const row = (event.target as Element)?.closest<HTMLElement>('[data-track-index]');
    if (!row || event.target !== row.firstElementChild) return;
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = Number(row.dataset.trackIndex);
    focused = event.key === 'Home' ? 0 : event.key === 'End' ? tracks.length - 1
      : Math.max(0, Math.min(tracks.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    await tick();
    const next = list.querySelector<HTMLElement>(`[data-track-index="${focused}"] > [role="button"]`);
    next?.focus({ preventScroll: true });
    next?.scrollIntoView?.({ block: 'nearest' });
  }
</script>

{#if virtual}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions : delegates navigation from the song row buttons -->
  <div bind:this={list} data-track-list class="relative mt-1" role="list" aria-label="Songs"
    style:height={`${tracks.length * rowHeight - 2}px`}
    use:virtualRows={{ count: tracks.length, rowHeight, onRange }}
    onfocusin={onFocus} onfocusout={onBlur} onkeydown={onKey}>
    {#each visible as index (tracks[index].videoId + ':' + index)}
      <div data-track-index={index} role="listitem" aria-posinset={index + 1} aria-setsize={tracks.length}
        class="absolute inset-x-0" style:top={`${index * rowHeight}px`}>
        <TrackRow track={tracks[index]} {index} list={tracks} {playlist} current={currentIndex === undefined ? undefined : index === currentIndex} {onPlay} />
      </div>
    {/each}
  </div>
{:else}
  <div class="mt-1 flex flex-col gap-0.5" role="list" aria-label="Songs">
    {#each tracks as track, index (track.videoId + ':' + index)}
      <div role="listitem"><TrackRow {track} {index} list={tracks} {playlist} current={currentIndex === undefined ? undefined : index === currentIndex} {onPlay} /></div>
    {/each}
  </div>
{/if}
