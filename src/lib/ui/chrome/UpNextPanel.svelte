<script lang="ts">
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  // Floating queue popup, anchored above the player bar. The full-screen player
  // shows the queue inline instead (see PlayerBar), so this only appears in the
  // collapsed-bar layout.
  import { fly, fade } from '$lib/ui/transitions';
  import QueueList from './QueueList.svelte';
  import QueueHeader from './QueueHeader.svelte';

  export let open = false;
  export let onClose: () => void;
  export let bottom = 96;


  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  // Close when the pointer goes down anywhere outside the panel.
  function onWindowMouseDown(event: MouseEvent) {
    if (!open) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-upnext-panel]')) return;
    if (target instanceof Element && target.closest('[data-upnext-toggle]')) return;
    onClose();
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={handleKey} />

{#if open}
  <div
    data-upnext-panel
    class="absolute right-3 z-40 flex max-h-[72vh] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
    style:bottom={`${bottom}px`}
    in:fly={{ y: 8, duration: 200 }}
    out:fade={{ duration: 120 }}
  >
    <QueueHeader {onClose} />

    <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-3 pb-3">
      <QueueList onNavigate={onClose} />
    </div>
  </div>
{/if}
