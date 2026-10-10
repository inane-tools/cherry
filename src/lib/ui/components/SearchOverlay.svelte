<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { closeSearch, searchOpen } from '$lib/app/services/overlays';
  import { pageStore } from '$lib/app/services/navigation';
  import SearchView from '$lib/ui/views/SearchView.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import DialogHeader from './DialogHeader.svelte';

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
    class="fixed inset-0 z-30 flex items-start justify-center bg-scrim/60 p-4 pt-16 backdrop-blur-[3px]"
    role="presentation"
    onclick={closeSearch}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <DialogHeader title="Search" description="Find music or paste a YouTube link." onClose={closeSearch} />
      <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-6 pb-6">
        <SearchView />
      </div>
    </div>
  </div>
{/if}
