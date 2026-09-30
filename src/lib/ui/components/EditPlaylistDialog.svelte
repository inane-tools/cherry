<script lang="ts">
  import type { Thumbnail } from '$lib/core/models';
  import { bestThumbnail } from '$lib/core/models';
  import { getPlaylistMeta } from '$lib/infra/ytmusic/InnertubeClient';
  import { authStore } from '$lib/app/services/auth';
  import { updatePlaylistDetails, setPlaylistImage } from '$lib/app/services/playlistEdit';
  import { closePlaylistEditor, playlistEditorStore } from '$lib/app/services/playlistEditor';

  $: state = $playlistEditorStore;
  $: playlist = state.playlist;

  let title = '';
  let description = '';
  let originalDescription = '';
  let descriptionLoaded = false;
  let metaThumbs: Thumbnail[] = [];
  let preview: string | null = null;
  // The picked image is held until Save, so nothing is uploaded on selection.
  let pendingImage: { dataBase64: string; mime: string } | null = null;
  let loading = false;
  let busy = false;

  // The card usually carries the artwork; a picked file previews immediately,
  // otherwise fall back to the live header.
  $: cover = playlist
    ? (preview ??
      bestThumbnail(playlist.thumbnails.length > 0 ? playlist.thumbnails : metaThumbs, 256))
    : '';

  async function onPickImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !playlist) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return;
    preview = URL.createObjectURL(file);
    pendingImage = { dataBase64: await fileToBase64(file), mime: file.type };
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Load the live metadata (the rail row has no description) whenever a new
  // playlist is opened, so saving cannot wipe an existing description.
  let loadedId: string | null = null;
  $: if (state.open && playlist && playlist.browseId !== loadedId) {
    loadedId = playlist.browseId;
    title = playlist.title;
    description = '';
    originalDescription = '';
    descriptionLoaded = false;
    metaThumbs = [];
    preview = null;
    pendingImage = null;
    loading = true;
    void getPlaylistMeta(playlist.browseId, $authStore).then((meta) => {
      if (loadedId !== playlist.browseId) return;
      title = meta?.title || playlist.title;
      if (meta) {
        originalDescription = meta.description ?? '';
        description = originalDescription;
        descriptionLoaded = true;
        metaThumbs = meta.thumbnails ?? [];
      }
      loading = false;
    });
  }
  $: if (!state.open) loadedId = null;

  async function save(): Promise<void> {
    if (busy || !playlist) return;
    busy = true;
    // The image is uploaded only now, and only when one was picked.
    if (pendingImage) {
      const imageOk = await setPlaylistImage(playlist, pendingImage.dataBase64, pendingImage.mime);
      if (!imageOk) {
        busy = false;
        return; // keep the dialog open so the reason stays visible
      }
      pendingImage = null;
    }
    // Only write the description when it was actually loaded and then changed —
    // an unread description must never be overwritten with an empty string.
    const next =
      descriptionLoaded && description !== originalDescription ? description : null;
    const ok = await updatePlaylistDetails(playlist, title, next);
    busy = false;
    if (ok) closePlaylistEditor();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closePlaylistEditor();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if state.open && playlist}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={closePlaylistEditor}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-elevated)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label="Edit playlist"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="h-1 w-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent2)]"></div>

      <header class="flex items-center gap-3 px-5 py-4">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/15 text-lg text-[var(--color-accent2)]"
        >
          <i class="bx bx-pencil"></i>
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[14px] font-semibold text-white">Edit playlist</h2>
          <p class="truncate text-[11px] text-zinc-500">{playlist.title}</p>
        </div>
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
          onclick={closePlaylistEditor}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <div class="flex items-center gap-4">
          <span
            class="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--color-art)] shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
          >
            {#if cover}
              <img src={cover} alt="" class="h-full w-full object-cover" />
            {:else}
              <span class="flex h-full w-full items-center justify-center text-zinc-600">
                <i class="bx bx-music text-3xl"></i>
              </span>
            {/if}
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-zinc-300">Cover image</div>
            <label
              class="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <i class="bx bx-image"></i>
              {pendingImage ? 'Choose another' : 'Choose image'}
              <input
                type="file"
                accept="image/png,image/jpeg"
                class="hidden"
                onchange={onPickImage}
              />
            </label>
            <p class="mt-2 text-[10px] leading-relaxed text-zinc-600">
              {pendingImage ? 'Applies when you press Save. ' : 'JPG or PNG. '}YouTube may require a
              verified phone number.
            </p>
          </div>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] font-medium text-zinc-400">Title</span>
          <input
            bind:value={title}
            disabled={loading}
            class="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] font-medium text-zinc-400">Description</span>
          <textarea
            bind:value={description}
            disabled={loading}
            rows="5"
            placeholder="Add a description…"
            class="resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[12px] leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
          ></textarea>
        </label>
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
        <button
          class="rounded-xl border border-white/10 px-4 py-2 text-[12px] text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          onclick={closePlaylistEditor}
        >
          Cancel
        </button>
        <button
          class="cherry-btn-scrim rounded-xl bg-[var(--color-accent)] px-5 py-2 text-[12px] font-semibold text-white transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          disabled={busy || loading || !title.trim()}
          onclick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  </div>
{/if}
