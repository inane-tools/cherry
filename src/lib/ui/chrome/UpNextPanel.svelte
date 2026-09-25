<script lang="ts">
  import { currentItem, queueItems, clearQueue } from '$lib/app/services/queue';
  import { playerStore, playQueueItem } from '$lib/app/services/player';
  import { bestThumbnail } from '$lib/core/models';
  import ArtistsLine from '$lib/ui/components/ArtistsLine.svelte';

  export let open = false;
  export let onClose: () => void;

  // The whole queue, not just the next few. The "Now playing" entry is pulled
  // out, so what remains is everything still to come — which is what the panel
  // is for (it previously capped at the next 10).
  $: items = $queueItems;
  $: currentId = $currentItem?.queueId ?? null;
  $: upcoming = items.filter((item) => item.queueId !== currentId);

  function pick(queueId: string) {
    void playQueueItem(queueId);
    onClose();
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

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  // Close when the pointer goes down anywhere outside the panel.
  function onWindowMouseDown(event: MouseEvent) {
    if (!open) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-upnext-panel]')) return;
    if (target instanceof Element && target.closest('[data-upnext-toggle]')) return;
    onClose();
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={handleKey} />

{#if open}
  <div
    data-upnext-panel
    class="absolute bottom-[112px] right-3 z-40 flex max-h-[70vh] w-[22rem] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0c0c0f]/95 shadow-[0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
  >
    <div class="flex items-center justify-between border-b border-white/5 px-4 py-3">
      <h2 class="text-[13px] font-bold text-white">Up next</h2>
      <div class="flex items-center gap-1">
        {#if items.length > 0}
          <button
            class="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-white"
            onclick={clearQueue}
          >
            Clear
          </button>
        {/if}
        <button
          class="flex h-6 w-6 items-center justify-center rounded-md text-base text-zinc-400 hover:bg-white/5 hover:text-white"
          aria-label="Close up next"
          onclick={onClose}
        >
          <i class="bx bx-x"></i>
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      {#if items.length === 0}
        <p class="px-2 py-3 text-[12px] text-zinc-500">
          Queue is empty. Play something and it will show up here.
        </p>
      {:else}
        {#if $currentItem}
          <div class="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Now playing</div>
          <div class="mb-2 flex items-center gap-2.5 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/10 p-2">
            {#if bestThumbnail($currentItem.track.thumbnails, 96)}
              <img src={bestThumbnail($currentItem.track.thumbnails, 96)} alt="" class="h-9 w-9 rounded-md object-cover" />
            {:else}
              <span class="flex h-9 w-9 items-center justify-center rounded-md bg-white/5 text-zinc-600">
                <i class="bx bx-music"></i>
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
          <div class="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            <span>Next up</span>
            <span>{upcoming.length} in queue</span>
          </div>
          <div class="flex flex-col gap-0.5">
            {#each upcoming as qi (qi.queueId)}
              <div
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                role="button"
                tabindex={0}
                onkeydown={(e) => onRowKey(e, qi.queueId)}
                onclick={() => pick(qi.queueId)}
              >
                {#if bestThumbnail(qi.track.thumbnails, 96)}
                  <img src={bestThumbnail(qi.track.thumbnails, 96)} alt="" class="h-9 w-9 rounded-md object-cover" loading="lazy" />
                {:else}
                  <span class="flex h-9 w-9 items-center justify-center rounded-md bg-white/5 text-zinc-600">
                    <i class="bx bx-music"></i>
                  </span>
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] text-zinc-200">{qi.track.title}</span>
                  <ArtistsLine artists={qi.track.artists} textClass="block truncate text-[11px] text-zinc-500" />
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="px-2 py-2 text-[11px] text-zinc-600">End of queue.</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}
