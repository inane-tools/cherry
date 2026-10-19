<script lang="ts">
  import { clearQueue, queueItems, upNextQueue } from '$lib/app/services/queue';

  export let onClose: (() => void) | undefined = undefined;
</script>

<header class="flex shrink-0 items-center gap-2 px-4 py-4">
  <h2 class="min-w-0 flex-1 truncate text-[20px] font-extrabold leading-none tracking-tight text-white">Queue</h2>
  <span class="flex h-8 shrink-0 items-center rounded-full bg-white/[0.06] px-3 text-[10px] font-medium leading-none tabular-nums text-zinc-400">{$upNextQueue.length} queued</span>
  {#if $queueItems.length > 0}
    <button
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
      aria-label="Clear queue"
      title="Clear queue"
      onclick={clearQueue}
    >
      <i class="ph ph-trash text-lg"></i>
    </button>
  {/if}
  {#if onClose}
  <button
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
    aria-label="Close queue"
    onclick={onClose}
  >
    <i class="ph ph-x text-xl"></i>
  </button>
  {/if}
</header>
