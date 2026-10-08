<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { closeSettings, settingsOpen } from '$lib/app/services/overlays';
  import SettingsView from '$lib/ui/views/SettingsView.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeSettings();
  }

  // Close on Escape (registration is per-mount; the component only exists while
  // open).
  onMount(() => {
    const handler = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
</script>

{#if $settingsOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-30 flex items-start justify-center bg-scrim/60 p-4 pt-16 backdrop-blur-[3px]"
    role="presentation"
    onclick={closeSettings}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <button
        class="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Close settings"
        onclick={closeSettings}
      >
        <i class="bx bx-x text-xl"></i>
      </button>
      <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 p-6">
        <SettingsView />
      </div>
    </div>
  </div>
{/if}
