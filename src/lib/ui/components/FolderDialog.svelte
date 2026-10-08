<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { createFolder, renameFolder } from '$lib/app/services/folders';
  import { closeFolderDialog, folderDialogStore } from '$lib/app/services/folderDialog';

  $: state = $folderDialogStore;
  $: editing = state.folder;

  let name = '';
  let busy = false;

  let loadedKey: string | null = null;
  $: if (state.open) {
    const key = editing?.id ?? 'new';
    if (key !== loadedKey) {
      loadedKey = key;
      name = editing?.name ?? '';
    }
  } else {
    loadedKey = null;
  }

  async function save(): Promise<void> {
    if (busy || !name.trim()) return;
    busy = true;
    try {
      if (editing) await renameFolder(editing.id, name);
      else await createFolder(name);
      closeFolderDialog();
    } finally {
      busy = false;
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeFolderDialog();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if state.open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]"
    role="presentation"
    onclick={closeFolderDialog}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="w-full max-w-sm overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Rename folder' : 'New folder'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <header class="flex items-center gap-3 px-5 py-4">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/15 text-lg text-[var(--color-accent2)]"
        >
          <i class="bx bxs-folder"></i>
        </span>
        <h2 class="min-w-0 flex-1 text-[14px] font-semibold text-white">
          {editing ? 'Rename folder' : 'New folder'}
        </h2>
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
          onclick={closeFolderDialog}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </header>

      <div class="px-5 pb-4">
        <input
          bind:value={name}
          placeholder="Folder name…"
          class="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60"
          onkeydown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
        <button
          class="rounded-xl border border-white/10 px-4 py-2 text-[12px] text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          onclick={closeFolderDialog}
        >
          Cancel
        </button>
        <button
          class="cherry-btn-scrim rounded-xl bg-[var(--color-accent)] px-5 py-2 text-[12px] font-semibold text-white transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          disabled={busy || !name.trim()}
          onclick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  </div>
{/if}
