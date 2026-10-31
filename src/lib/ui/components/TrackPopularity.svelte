<script lang="ts">
  import { popularityLevel } from '$lib/core/popularity';
  export let count: number | undefined;
  export let countText: string | undefined = undefined;
  export let maximum: number;
  export let minimum = 0;
  $: level = popularityLevel(count, maximum, minimum);
  $: label = level === undefined ? 'Play count unavailable'
    : `${countText || `${count?.toLocaleString()} plays`} · ${level} of 5 popularity bars within this album`;
</script>

<span class="flex h-5 w-16 shrink-0 items-center justify-center" role="img" aria-label={label} title={label}>
  {#if level === undefined}
    <span class="text-xs text-zinc-600" aria-hidden="true">—</span>
  {:else}
    <span class="flex items-center gap-[3px]" aria-hidden="true">
      {#each [1, 2, 3, 4, 5] as bar}
        <span data-popularity-active={bar <= level} class="h-3 w-[3px] rounded-[1px] {bar <= level ? 'bg-zinc-400' : 'bg-white/10'}"></span>
      {/each}
    </span>
  {/if}
</span>
