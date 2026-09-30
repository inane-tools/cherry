<script lang="ts">
  import type { Track } from '$lib/core/models';
  import { bestThumbnail } from '$lib/core/models';
  import { playerStore } from '$lib/app/services/player';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { trackMenu } from '$lib/app/services/menus';
  import ArtistsLine from './ArtistsLine.svelte';

  export let track: Track;
  export let index: number;
  export let onPlay: (t: Track, i: number) => void;
  /** The list this row belongs to, so "Play" starts the whole list here. */
  export let list: Track[] | undefined = undefined;
  /** Set on a playlist page so the menu can offer "Remove from this playlist". */
  export let playlist: import('$lib/core/models').Playlist | undefined = undefined;

  $: isCurrent = $playerStore.track?.videoId === track.videoId;
  $: playing = isCurrent && $playerStore.status === 'playing';

  function fmt(s?: number): string {
    if (s == null || !Number.isFinite(s)) return '';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  function onContext(event: MouseEvent): void {
    openContextMenu(event, trackMenu(track, list, index, playlist));
  }

  // The row is a div (not a button) so the artist names inside it can be their
  // own buttons. Keys only play the row when the row itself has focus.
  function onRowKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPlay(track, index);
    }
  }
</script>

<div
  class="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5 {isCurrent
    ? 'bg-[var(--color-accent)]/10'
    : ''}"
  role="button"
  tabindex={0}
  onkeydown={onRowKey}
  onclick={() => onPlay(track, index)}
  oncontextmenu={onContext}
>
  <span class="w-6 text-center text-xs text-zinc-600 group-hover:hidden">{index + 1}</span>
  <span class="hidden w-6 items-center justify-center group-hover:flex">
    <i class={playing ? 'bx bx-pause text-[var(--color-accent2)]' : 'bx bx-play text-zinc-200'}></i>
  </span>
  {#if bestThumbnail(track.thumbnails, 96)}
    <img src={bestThumbnail(track.thumbnails, 96)} alt="" class="h-10 w-10 rounded-md object-cover" loading="lazy" />
  {:else}
    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-art)] text-zinc-600">
      <i class="bx bx-music text-lg"></i>
    </div>
  {/if}
  <span class="min-w-0 flex-1">
    <span class="block truncate text-sm {isCurrent ? 'text-[var(--color-accent2)]' : ''}">{track.title}</span>
    <ArtistsLine artists={track.artists} textClass="block truncate text-xs text-zinc-500" />
  </span>
  <span class="text-xs text-zinc-600">{fmt(track.durationSeconds)}</span>
</div>
