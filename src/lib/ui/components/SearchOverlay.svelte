<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { closeSearch, searchOpen } from '$lib/app/services/overlays';
  import { pageStore } from '$lib/app/services/navigation';
  import SearchView from '$lib/ui/views/SearchView.svelte';

  // Navigating from a result (or anywhere) closes the search popup. Skip the
  // initial emission so subscribing does not immediately close it.
  onMount(() => {
    let first = true;
    const unsub = pageStore.subscribe(() => {
      if (first) {
        first = false;
        return;
      }
      closeSearch();
    });
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', handler);
    return () => {
      unsub();
      window.removeEventListener('keydown', handler);
    };
  });
</script>

{#if $searchOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 p-4 pt-[12vh]"
    role="presentation"
    onclick={closeSearch}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="relative w-full max-w-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <SearchView compact onClose={closeSearch} />
    </div>
  </div>
{/if}
