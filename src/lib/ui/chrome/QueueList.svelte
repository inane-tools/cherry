<script lang="ts">
  // The queue contents: "Now playing" + the upcoming list, with drag-to-reorder
  // and remove. Shared by the floating queue popup (bar mode) and the inline
  // queue in the full-screen player.
  import {
    currentItem,
    queueItems,
    upNextQueue,
    reorderQueueTo,
    removeFromQueue,
  } from '$lib/app/services/queue';
  import { playerStore, playQueueItem } from '$lib/app/services/player';
  import { bestThumbnail } from '$lib/core/models';
  import ArtistsLine from '$lib/ui/components/ArtistsLine.svelte';

  /** Called after a row is chosen (the popup uses it to close itself). */
  export let onNavigate: () => void = () => {};

  $: items = $queueItems;
  $: upcoming = $upNextQueue;

  // Clicking a row plays it *and* drops everything before it (queue.ts).
  function pick(queueId: string) {
    void playQueueItem(queueId);
    onNavigate();
  }

  // ── Drag to reorder ─────────────────────────────────────────────
  let dragId: string | null = null;
  let dropIndex: number | null = null;
  $: dragIndex = dragId ? upcoming.findIndex((item) => item.queueId === dragId) : -1;
  // One line per gap: hide it when the target is the dragged row's own gap.
  $: showDropLine = dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1;

  function onDragStart(event: DragEvent, queueId: string): void {
    dragId = queueId;
    dropIndex = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', queueId);
    }
  }

  function onDragOver(event: DragEvent, index: number): void {
    if (!dragId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Top half → the gap before this row; bottom half → the gap after it. Both
    // "after row i" and "before row i+1" resolve to the same index, so there is
    // a single drop slot per gap.
    dropIndex = event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    if (dragId && dropIndex !== null) reorderQueueTo(dragId, dropIndex);
    onDragEnd();
  }

  function onDragEnd(): void {
    dragId = null;
    dropIndex = null;
  }

  // Rows are divs (so the artist names can be buttons); keys only play the row
  // when the row itself has focus.
  function onRowKey(event: KeyboardEvent, queueId: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(queueId);
    }
  }

  function remove(event: MouseEvent, queueId: string): void {
    event.stopPropagation();
    removeFromQueue(queueId);
  }
</script>

{#if items.length === 0}
  <p class="px-3 py-6 text-center text-[12px] text-zinc-500">
    Queue is empty. Play something and it will show up here.
  </p>
{:else}
  {#if $currentItem}
    <div class="mb-1 px-2 text-[11px] font-medium text-zinc-400">
      Now playing
    </div>
    <div
      class="mb-3 flex items-center gap-2 rounded-lg bg-[var(--color-accent)]/10 px-2 py-1.5"
    >
      {#if bestThumbnail($currentItem.track.thumbnails, 96)}
        <img src={bestThumbnail($currentItem.track.thumbnails, 96)} alt="" class="h-8 w-8 shrink-0 rounded-lg object-cover" />
      {:else}
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-600">
          <i class="bx bx-music text-lg"></i>
        </span>
      {/if}
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[12px] font-medium text-white">{$currentItem.track.title}</span>
        <ArtistsLine artists={$currentItem.track.artists} textClass="block truncate text-[11px] text-zinc-400" />
      </span>
      {#if $playerStore.status === 'playing'}
        <i class="bx bx-volume-full text-[var(--color-accent2)]"></i>
      {/if}
    </div>
  {/if}

  {#if upcoming.length > 0}
    <div class="mb-1 px-2 text-[11px] font-medium text-zinc-400">Next up</div>
    <div class="flex flex-col gap-0.5">
      {#each upcoming as qi, i (qi.queueId)}
        <div
          class="group relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] {dragId ===
          qi.queueId
            ? 'opacity-40'
            : ''}"
          role="button"
          tabindex={0}
          draggable="true"
          ondragstart={(event) => onDragStart(event, qi.queueId)}
          ondragover={(event) => onDragOver(event, i)}
          ondrop={onDrop}
          ondragend={onDragEnd}
          onkeydown={(event) => onRowKey(event, qi.queueId)}
          onclick={() => pick(qi.queueId)}
        >
          {#if showDropLine && dropIndex === i}
            <span class="pointer-events-none absolute inset-x-2 -top-1 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
          {/if}
          {#if showDropLine && dropIndex === upcoming.length && i === upcoming.length - 1}
            <span class="pointer-events-none absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
          {/if}
          <i
            class="bx bx-dots-vertical-rounded shrink-0 text-base text-zinc-600 transition-colors group-hover:text-zinc-400"
            aria-hidden="true"
          ></i>
          {#if bestThumbnail(qi.track.thumbnails, 96)}
            <img src={bestThumbnail(qi.track.thumbnails, 96)} alt="" draggable="false" class="h-8 w-8 shrink-0 rounded-lg object-cover" loading="lazy" />
          {:else}
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-600">
              <i class="bx bx-music text-lg"></i>
            </span>
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12px] text-zinc-100">{qi.track.title}</span>
            <ArtistsLine artists={qi.track.artists} textClass="block truncate text-[11px] text-zinc-500" />
          </span>
          <button
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg text-zinc-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
            title="Remove from queue"
            aria-label="Remove from queue"
            onclick={(event) => remove(event, qi.queueId)}
          >
            <i class="bx bx-x"></i>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="px-3 py-3 text-center text-[11px] text-zinc-600">End of queue.</p>
  {/if}
{/if}
