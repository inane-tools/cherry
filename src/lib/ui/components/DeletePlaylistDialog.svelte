<script lang="ts">
  import { fade, fly } from '$lib/ui/transitions';
  import { playlistDeleteStore, cancelPlaylistDeletion, confirmPlaylistDeletion } from '$lib/app/services/playlistDelete';
  import DialogHeader from './DialogHeader.svelte';
  $: state = $playlistDeleteStore;
  function focusCancel(node: HTMLButtonElement) {
    const previous = document.activeElement;
    node.focus();
    return { destroy() { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
  }
  function dialogKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.stopPropagation(); cancelPlaylistDeletion(); }
    if (event.key === 'Tab') {
      const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const next = event.shiftKey ? buttons.at(-1) : buttons[0];
      if (document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) { event.preventDefault(); next?.focus(); }
    }
  }
</script>


{#if state.playlist}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]" role="presentation" onclick={cancelPlaylistDeletion} in:fade={{ duration: 150 }} out:fade={{ duration: 120 }}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="w-full max-w-md rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]" role="dialog" aria-modal="true" aria-label="Delete playlist" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={dialogKey} in:fly={{ y: -12, duration: 180 }}>
      <DialogHeader title="Delete playlist?" onClose={cancelPlaylistDeletion} />
      <div class="space-y-3 px-6 text-[13px] leading-relaxed text-zinc-300">
        <p>Permanently delete <strong class="text-white">“{state.playlist.title}”</strong> from your YouTube Music account?</p>
        <p>This deletes the playlist itself, not just its library entry. It cannot be undone. The songs will not be deleted.</p>
        {#if state.error}<p role="alert" class="text-red-400">{state.error}</p>{/if}
      </div>
      <footer class="flex justify-end gap-2 p-6">
        <button use:focusCancel class="rounded-lg bg-white/[0.06] px-4 py-2 text-[12px] text-zinc-200 hover:bg-white/[0.1] disabled:opacity-40" disabled={state.busy} onclick={cancelPlaylistDeletion}>Cancel</button>
        <button class="rounded-lg bg-red-600 px-4 py-2 text-[12px] font-semibold hover:bg-red-500 disabled:opacity-40" style="color: #fff" disabled={state.busy} onclick={() => confirmPlaylistDeletion()}>{state.busy ? 'Deleting…' : 'Delete permanently'}</button>
      </footer>
    </div>
  </div>
{/if}
