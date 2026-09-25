<script lang="ts">
  /**
   * Placeholder rows shaped like `TrackRow`, so a loading list keeps the same
   * rhythm as the real one instead of collapsing to a single line of text.
   */
  export let rows = 8;
  export let showHeader = true;

  const skeletons = Array.from({ length: rows });
</script>

{#if showHeader}
  <div class="flex items-center gap-3 border-b border-white/5 px-2 pb-2">
    <div class="h-2.5 w-6 animate-pulse rounded bg-white/5"></div>
    <div class="h-2.5 flex-1 animate-pulse rounded bg-white/5"></div>
    <div class="h-2.5 w-10 animate-pulse rounded bg-white/5"></div>
  </div>
{/if}

<div class="mt-1 flex flex-col gap-0.5">
  {#each skeletons as _row}
    <div class="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <div class="h-3 w-6 animate-pulse rounded bg-white/5"></div>
      <div class="h-10 w-10 shrink-0 animate-pulse rounded-md bg-white/5"></div>
      <div class="min-w-0 flex-1 space-y-1.5">
        <div class="h-3 w-2/5 animate-pulse rounded bg-white/5"></div>
        <div class="h-2.5 w-1/4 animate-pulse rounded bg-white/5"></div>
      </div>
      <div class="h-3 w-8 animate-pulse rounded bg-white/5"></div>
    </div>
  {/each}
</div>
