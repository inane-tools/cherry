<script lang="ts">
  import { clearQueue, queueItems, upNextQueue } from '$lib/app/services/queue';

  export let onClose: () => void;
</script>

<header class="flex shrink-0 items-center gap-2 px-4 py-4">
  <div class="min-w-0 flex-1">
    <h2 class="truncate text-[20px] font-extrabold tracking-tight text-white">Queue</h2>
    <p class="mt-0.5 text-[11px] text-zinc-500">{$upNextQueue.length} up next</p>
  </div>
  {#if $queueItems.length > 0}
    <button
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
      aria-label="Clear queue"
      title="Clear queue"
      onclick={clearQueue}
    >
      <i class="bx bx-trash text-lg"></i>
    </button>
  {/if}
  <button
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
    aria-label="Close queue"
    onclick={onClose}
  >
    <i class="bx bx-x text-xl"></i>
  </button>
</header>
