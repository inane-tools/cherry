<script lang="ts">
  import { onDestroy } from 'svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { fly, fade } from '$lib/ui/transitions';
  import type { Playlist, Thumbnail } from '$lib/core/models';
  import { bestThumbnail, thumbnailSources } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import { getActiveChannel, getPlaylistMeta } from '$lib/infra/ytmusic/InnertubeClient';
  import { authIdentity } from '$lib/infra/ytmusic/authContext';
  import { authStore } from '$lib/app/services/auth';
  import { createNewPlaylist, updatePlaylistDetails, setPlaylistImage } from '$lib/app/services/playlistEdit';
  import { closePlaylistEditor, playlistEditorStore, type PlaylistEditorState } from '$lib/app/services/playlistEditor';
  import DialogHeader from './DialogHeader.svelte';

  $: state = $playlistEditorStore;
  $: playlist = state.playlist;
  $: creating = !playlist;
  let title = '';
  let description = '';
  let originalDescription = '';
  let descriptionLoaded = false;
  let metaThumbs: Thumbnail[] = [];
  let preview: string | null = null;
  let pendingImage: { dataBase64: string; mime: string } | null = null;
  let loading = false;
  let busy = false;
  let readingImage = false;
  let imageError = '';
  let destroyed = false;
  // Retain the ID after creation if saving the image/details needs a retry.
  let createdPlaylist: Playlist | null = null;
  let loadedState: PlaylistEditorState | null = null;
  $: cover = preview ?? bestThumbnail(playlist?.thumbnails.length ? playlist.thumbnails : metaThumbs, 256);

  function clearPreview(): void {
    if (preview) URL.revokeObjectURL(preview);
    preview = null;
  }
  onDestroy(() => { destroyed = true; clearPreview(); });

  async function onPickImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || busy) return;
    imageError = '';
    if (!/^image\/(png|jpeg)$/.test(file.type)) { imageError = 'Choose a JPG or PNG image.'; return; }
    const opening = state;
    clearPreview();
    const imageUrl = URL.createObjectURL(file);
    preview = imageUrl;
    pendingImage = null;
    readingImage = true;
    try {
      const dataBase64 = await fileToBase64(file);
      if (!destroyed && state === opening && preview === imageUrl) pendingImage = { dataBase64, mime: file.type };
    } catch {
      if (!destroyed && state === opening && preview === imageUrl) {
        clearPreview(); imageError = 'Could not read that image. Try another file.';
      }
    } finally {
      if (state === opening && preview === imageUrl) readingImage = false;
      else if (state === opening && !preview) readingImage = false;
    }
  }
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  function initialize(opening: PlaylistEditorState): void {
    const target = opening.playlist;
    title = target?.title ?? '';
    description = originalDescription = '';
    descriptionLoaded = !target;
    metaThumbs = [];
    clearPreview(); pendingImage = null;
    createdPlaylist = null;
    busy = readingImage = false;
    imageError = '';
    loading = !!target;
    if (!target) return;
    void getPlaylistMeta(target.browseId, $authStore).then(meta => {
      if (destroyed || state !== opening) return;
      title = meta?.title || target.title;
      if (meta) {
        description = originalDescription = meta.description ?? '';
        descriptionLoaded = true;
        metaThumbs = meta.thumbnails ?? [];
      }
    }).catch(() => {}).finally(() => { if (!destroyed && state === opening) loading = false; });
  }
  $: if (state.open && state !== loadedState) {
    loadedState = state;
    initialize(state);
  }
  $: if (!state.open && loadedState) {
    loadedState = null;
    clearPreview(); pendingImage = null;
  }

  async function save(): Promise<void> {
    if (busy || loading || readingImage || !title.trim()) return;
    const opening = state;
    const owner = authIdentity($authStore), channel = getActiveChannel();
    const current = () => !destroyed && state === opening && authIdentity($authStore) === owner && getActiveChannel() === channel;
    busy = true;
    try {
      let target = createdPlaylist ?? playlist;
      if (!target) {
        const id = await createNewPlaylist(title, opening.tracks);
        if (!id || !current()) return;
        target = createdPlaylist = { browseId: id, title: title.trim(), thumbnails: [] };
      }
      if (pendingImage) {
        const imageOk = await setPlaylistImage(target, pendingImage.dataBase64, pendingImage.mime);
        if (!current() || !imageOk) return;
        pendingImage = null;
      }
      const next = descriptionLoaded && description !== originalDescription ? description : null;
      if (title.trim() !== target.title || next !== null) {
        const ok = await updatePlaylistDetails(target, title, next);
        if (!current() || !ok) return;
        originalDescription = description;
        if (creating) createdPlaylist = { ...target, title: title.trim() };
      }
      if (current()) closePlaylistEditor();
    } finally {
      if (!destroyed && state === opening) busy = false;
    }
  }
  function requestClose(): void { if (!busy) closePlaylistEditor(); }
  function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') requestClose(); }
</script>

<svelte:window onkeydown={onKey} />

{#if state.open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]"
    role="presentation"
    onclick={requestClose}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label={creating ? 'New playlist' : 'Edit playlist'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -10, duration: 220 }}
      out:fade={{ duration: 140 }}
    >
      <DialogHeader title={creating ? 'New playlist' : 'Edit playlist'} description={creating ? (state.tracks.length ? `${state.tracks.length} ${state.tracks.length === 1 ? 'song' : 'songs'} will be added` : undefined) : playlist?.title} onClose={requestClose} />

      <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-6">
        <div class="flex flex-col gap-4">
          <!-- The cover image is itself the upload target (hover reveals the
               action) and sits inline with the title field. -->
          <div class="flex items-start gap-4">
            <label
              class="group relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-[var(--color-art)]"
            >
              {#if cover}
                <img use:artwork={{ urls: preview ? [preview] : thumbnailSources([...(playlist?.thumbnails ?? []), ...metaThumbs], 256) }} alt="" class="h-full w-full object-cover" />
              {:else}
                <span class="flex h-full w-full items-center justify-center text-zinc-600">
                  <i class="ph-duotone ph-music-notes text-3xl"></i>
                </span>
              {/if}
              <span
                class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <i class="ph ph-upload-simple text-xl"></i>
                <span class="text-[9px] font-medium">Upload</span>
              </span>
              <input
                type="file"
                disabled={busy || readingImage}
                aria-label="Playlist cover image"
                accept="image/png,image/jpeg"
                class="hidden"
                onchange={onPickImage}
              />
            </label>
            <label class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="text-[11px] font-medium text-zinc-400">Title</span>
              <input
                bind:value={title}
                onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
                disabled={loading || busy}
                class="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
              />
              <span class="text-[10px] leading-relaxed text-zinc-600">
                {pendingImage
                  ? `New cover applies when you press ${creating && !createdPlaylist ? 'Create' : 'Save'}.`
                  : 'Hover the cover to change it. JPG or PNG.'}
              </span>
            </label>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-zinc-400">Description</span>
            <textarea
              use:overlayScrollbar
              bind:value={description}
              disabled={loading || busy || !descriptionLoaded}
              rows="5"
              placeholder="Add a description…"
              class="cherry-overlay-scroll resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 disabled:opacity-50"
            ></textarea>
          </label>
          {#if imageError}<p class="text-[11px] text-rose-300" role="alert">{imageError}</p>{/if}
        </div>
      </div>

      <footer class="flex shrink-0 items-center justify-end gap-2 p-6">
        <button
          class="rounded-lg bg-white/[0.06] px-4 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
          onclick={requestClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          class="cherry-btn-scrim rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent2)] disabled:opacity-40"
          disabled={busy || loading || readingImage || !title.trim()}
          onclick={save}
        >
          {busy ? (creating && !createdPlaylist ? 'Creating…' : 'Saving…') : creating && !createdPlaylist ? 'Create' : 'Save'}
        </button>
      </footer>
    </div>
  </div>
{/if}
