<script lang="ts">
  import { onDestroy } from 'svelte';
  import Spinner from './Spinner.svelte';

  export let loading = false;
  export let playing = false;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $: if (loading) {
    if (!timer) timer = setTimeout(() => { visible = true; }, 300);
  } else {
    clearTimeout(timer);
    timer = undefined;
    visible = false;
  }
  onDestroy(() => clearTimeout(timer));
</script>

{#if loading && visible}
  <Spinner size={20} />
{:else if playing}
  <i class="ph-fill ph-pause" aria-hidden="true"></i>
{:else}
  <i class="ph-fill ph-play" aria-hidden="true"></i>
{/if}
