<script lang="ts">
  // Floating queue popup, anchored above the player bar. The full-screen player
  // shows the queue inline instead (see PlayerBar), so this only appears in the
  // collapsed-bar layout.
  import { clearQueue, queueItems, upNextQueue } from '$lib/app/services/queue';
  import { fly, fade } from 'svelte/transition';
  import QueueList from './QueueList.svelte';

  export let open = false;
  export let onClose: () => void;

  $: items = $queueItems;
  $: upcoming = $upNextQueue;

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
    class="absolute bottom-[136px] right-3 z-40 flex max-h-[72vh] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-elevated)]/95 shadow-[0_30px_80px_rgba(0,0,0,0.72)] backdrop-blur-2xl sm:bottom-24"
    in:fly={{ y: 10, duration: 170 }}
    out:fade={{ duration: 120 }}
  >
    <header class="flex items-center gap-3 px-4 py-3.5">
      <h2 class="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">Queue</h2>
      <span
        class="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400"
      >
        {upcoming.length} up next
      </span>
      {#if items.length > 0}
        <button
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Clear queue"
          title="Clear queue"
          onclick={clearQueue}
        >
          <i class="bx bx-trash text-lg"></i>
        </button>
      {/if}
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        aria-label="Close queue"
        onclick={onClose}
      >
        <i class="bx bx-x text-xl"></i>
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
      <QueueList onNavigate={onClose} />
    </div>
  </div>
{/if}
