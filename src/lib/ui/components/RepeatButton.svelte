<script lang="ts">
  // Repeat toggle: off → all → one. The "1" badge marks repeat-one.
  import { cycleRepeat } from '$lib/app/services/player';
  import { repeatMode } from '$lib/app/services/queue';

  export let size: 'sm' | 'lg' = 'sm';

  $: label = $repeatMode === 'off' ? 'Repeat: off' : $repeatMode === 'all' ? 'Repeat: all' : 'Repeat: one';
</script>

<button
  class="relative flex h-9 w-9 items-center justify-center rounded-full {size === 'lg' ? 'text-xl' : 'text-lg'} {$repeatMode !== 'off'
    ? 'text-[var(--color-accent2)]'
    : 'text-zinc-400 hover:text-white'}"
  onclick={() => cycleRepeat()}
  title={label}
  aria-label={label}
  aria-pressed={$repeatMode !== 'off'}
>
  <i class="bx bx-repeat"></i>
  {#if $repeatMode === 'one'}
    <span class="absolute right-1 top-1 text-[8px] font-bold leading-none">1</span>
  {/if}
</button>
