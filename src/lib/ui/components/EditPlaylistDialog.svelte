<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import type { Thumbnail } from '$lib/core/models';
  import { bestThumbnail } from '$lib/core/models';
  import { getPlaylistMeta } from '$lib/infra/ytmusic/InnertubeClient';
  import { authStore } from '$lib/app/services/auth';
  import { updatePlaylistDetails, setPlaylistImage } from '$lib/app/services/playlistEdit';
  import { closePlaylistEditor, playlistEditorStore } from '$lib/app/services/playlistEditor';
  import DialogHeader from './DialogHeader.svelte';

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
    class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]"
    role="presentation"
    onclick={closePlaylistEditor}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label="Edit playlist"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <DialogHeader title="Edit playlist" description={playlist.title} onClose={closePlaylistEditor} />

      <div class="min-h-0 flex-1 overflow-y-auto px-6">
        <div class="flex flex-col gap-4">
          <!-- The cover image is itself the upload target (hover reveals the
               action) and sits inline with the title field. -->
          <div class="flex items-start gap-4">
            <label
              class="group relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-[var(--color-art)]"
            >
              {#if cover}
                <img src={cover} alt="" class="h-full w-full object-cover" />
              {:else}
                <span class="flex h-full w-full items-center justify-center text-zinc-600">
                  <i class="bx bx-music text-3xl"></i>
                </span>
              {/if}
              <span
                class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <i class="bx bx-upload text-xl"></i>
                <span class="text-[9px] font-medium">Upload</span>
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                class="hidden"
                onchange={onPickImage}
              />
            </label>
            <label class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="text-[11px] font-medium text-zinc-400">Title</span>
              <input
                bind:value={title}
                disabled={loading}
                class="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
              />
              <span class="text-[10px] leading-relaxed text-zinc-600">
                {pendingImage
                  ? 'New cover applies when you press Save.'
                  : 'Hover the cover to change it. JPG or PNG.'}
              </span>
            </label>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-zinc-400">Description</span>
            <textarea
              bind:value={description}
              disabled={loading}
              rows="5"
              placeholder="Add a description…"
              class="resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
            ></textarea>
          </label>
        </div>
      </div>

      <footer class="flex shrink-0 items-center justify-end gap-2 p-6">
        <button
          class="rounded-lg bg-white/[0.06] px-4 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
          onclick={closePlaylistEditor}
        >
          Cancel
        </button>
        <button
          class="cherry-btn-scrim rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent2)] disabled:opacity-40"
          disabled={busy || loading || !title.trim()}
          onclick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  </div>
{/if}
