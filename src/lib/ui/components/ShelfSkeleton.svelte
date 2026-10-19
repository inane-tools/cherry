<script lang="ts">
  export let hero = false;
  export let grid = false;
  $: cards = Array.from({ length: grid ? 12 : 7 });
</script>

<div class="cherry-loading-skeleton overflow-hidden" role="status" aria-label="Loading recommendations">
  {#each grid ? [0] : [0, 1] as row}
    <section class="mb-8" aria-hidden="true">
      {#if !grid}<div class="mb-3 h-6 w-40 rounded-lg bg-white/5"></div>{/if}
      <div class={grid ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-x-3 gap-y-5' : 'flex gap-3'}>
        {#each cards as _}
          <div class="min-w-0 shrink-0 {grid ? '' : hero && row === 0 ? 'w-48 sm:w-56' : 'w-36 sm:w-40'}">
            <div class="aspect-square bg-white/5 {hero && row === 0 ? 'rounded-2xl' : 'rounded-xl'}"></div>
            <div class="mt-2 h-3 w-3/4 rounded bg-white/5"></div>
            <div class="mt-2 h-3 w-1/2 rounded bg-white/5"></div>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>
