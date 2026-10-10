<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import type { Playlist, PlaylistFolder } from '$lib/core/models';
  import { authStore } from '$lib/app/services/auth';
  import {
    openPlaylist,
    libraryError,
    libraryLoading,
    refreshLibrary,
    playlistStore,
  } from '$lib/app/services/playlists';
  import { back, canGoBack, go, pageStore } from '$lib/app/services/navigation';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { playlistMenu, folderMenu } from '$lib/app/services/menus';
  import { openPlaylistPicker } from '$lib/app/services/playlistPicker';
  import { loadAddablePlaylists } from '$lib/app/services/addablePlaylists';
  import {
    collapsedFolders,
    foldersStore,
    movePlaylist,
    movePlaylistToFolder,
    reorderFolder,
    sidebarOrderStore,
    toggleFolder,
  } from '$lib/app/services/folders';
  import { openFolderDialog } from '$lib/app/services/folderDialog';
  import { pinnedStore } from '$lib/app/services/pins';
  import { settingsStore, updateSettings } from '$lib/app/services/settings';
  import { closeSidebarDrawer } from '$lib/app/services/layout';

  /**
   * Force the full (named) layout even when compact mode is on. The drawer has
   * the whole screen width, so it always shows names.
   */
  export let forceFull = false;

  $: compact = $settingsStore.compactSidebar && !forceFull;

  onMount(() => {
    void loadAddablePlaylists();
    // Any navigation closes the narrow-mode drawer. Skip the initial emission —
    // otherwise subscribing here immediately closed the drawer we just opened
    // (which is why the hamburger appeared to do nothing).
    let first = true;
    const unsub = pageStore.subscribe(() => {
      if (first) {
        first = false;
        return;
      }
      closeSidebarDrawer();
    });
    return unsub;
  });

  /** The + button opens a small chooser (playlist or folder). */
  function openNewMenu(event: MouseEvent): void {
    openContextMenu(event, [
      { label: 'New playlist', icon: 'bx bx-list-plus', action: () => openPlaylistPicker() },
      { label: 'New folder', icon: 'bx bx-folder-plus', action: () => openFolderDialog(null) },
    ]);
  }

  // ── Sidebar contents ────────────────────────────────────────────
  // One flat, user-ordered list: playlists and folders coexist. Ids missing
  // from the saved order are appended in the order the library returned them,
  // so a fresh install just shows whatever the API gives us and the user then
  // arranges it however they like.
  type TopItem =
    | { id: string; type: 'playlist'; playlist: Playlist }
    | { id: string; type: 'folder'; folder: PlaylistFolder; items: Playlist[] };

  $: playlists = $playlistStore;
  $: pinnedOrder = $pinnedStore.map((p) => p.browseId);
  $: pinnedIds = new Set(pinnedOrder);
  $: assignedIds = new Set($foldersStore.flatMap((f) => f.playlistIds));
  $: folderEntries = $foldersStore.map((f) => ({
    folder: f,
    items: f.playlistIds
      .map((id) => playlists.find((p) => p.browseId === id))
      .filter((p): p is Playlist => Boolean(p)),
  }));
  $: topItems = buildTopItems($sidebarOrderStore, playlists, assignedIds, folderEntries, pinnedOrder);

  function buildTopItems(
    order: string[],
    list: Playlist[],
    assigned: Set<string>,
    folders: { folder: PlaylistFolder; items: Playlist[] }[],
    pinnedOrder: string[],
  ): TopItem[] {
    const topPlaylists = list.filter((p) => !assigned.has(p.browseId));
    const playlistById = new Map(topPlaylists.map((p) => [p.browseId, p]));
    const folderById = new Map(folders.map((f) => [f.folder.id, f]));
    const out: TopItem[] = [];
    const used = new Set<string>();

    const push = (id: string): void => {
      if (used.has(id)) return;
      const p = playlistById.get(id);
      if (p) {
        out.push({ id, type: 'playlist', playlist: p });
        used.add(id);
        return;
      }
      const f = folderById.get(id);
      if (f) {
        out.push({ id, type: 'folder', folder: f.folder, items: f.items });
        used.add(id);
      }
    };

    for (const id of order) push(id);
    for (const p of topPlaylists) push(p.browseId);
    for (const f of folders) push(f.folder.id);

    // Pinned playlists float to the top, in the order they were pinned.
    const rank = new Map(pinnedOrder.map((id, i) => [id, i]));
    const pinned: TopItem[] = [];
    const rest: TopItem[] = [];
    for (const item of out) {
      if (item.type === 'playlist' && rank.has(item.id)) pinned.push(item);
      else rest.push(item);
    }
    pinned.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [...pinned, ...rest];
  }

  // ── Drag to reorganise ──────────────────────────────────────────
  // A single delegated handler on the scroll container drives everything, based
  // on `data-top-*` (top-level entries), `data-folder-header` (drop into a
  // folder) and `data-child-*` (position inside an open folder). Full and
  // compact layouts behave identically.
  //
  // NOTE: indicators are compared *inline* against `drag`/`drop` in the markup
  // (not via helper functions) because this component uses legacy reactivity —
  // the compiler only tracks variables referenced directly in the template.
  type DragState =
    | { kind: 'playlist'; id: string; topIndex: number; folderId: string | null; childIndex: number }
    | { kind: 'folder'; id: string; topIndex: number };
  type DropState =
    | { kind: 'top'; index: number }
    | { kind: 'in-folder'; folderId: string; index: number }
    | { kind: 'folder'; folderId: string };

  let drag: DragState | null = null;
  let drop: DropState | null = null;

  function belowMid(event: DragEvent, el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function startPlaylistDrag(
    event: DragEvent,
    id: string,
    topIndex: number,
    folderId: string | null,
    childIndex: number,
  ): void {
    drag = { kind: 'playlist', id, topIndex, folderId, childIndex };
    drop = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }
  function startFolderDrag(event: DragEvent, id: string, topIndex: number): void {
    drag = { kind: 'folder', id, topIndex };
    drop = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }
  function endDrag(): void {
    drag = null;
    drop = null;
  }

  function onDragOver(event: DragEvent): void {
    if (!drag) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const target = event.target as HTMLElement | null;
    const child = target?.closest?.('[data-child-id]') as HTMLElement | null;
    const header = target?.closest?.('[data-folder-header]') as HTMLElement | null;
    const zone = target?.closest?.('[data-child-zone]') as HTMLElement | null;

    // Position inside an open folder (a child row, or the tinted padding).
    if (drag.kind === 'playlist' && (child || zone)) {
      const source = (child ?? zone) as HTMLElement;
      const folderId = (child ? source.dataset.folder : source.dataset.childZone) as string;
      const index = child
        ? Number(source.dataset.childIndex) + (belowMid(event, source) ? 1 : 0)
        : Number(zone?.dataset.childCount ?? 0);
      if (
        drag.folderId === folderId &&
        (index === drag.childIndex || index === drag.childIndex + 1)
      ) {
        drop = null;
        return;
      }
      drop = { kind: 'in-folder', folderId, index };
      return;
    }

    // A playlist dropped on the folder header joins the folder.
    if (drag.kind === 'playlist' && header) {
      drop = { kind: 'folder', folderId: header.dataset.folderHeader as string };
      return;
    }

    // Otherwise insert into the top-level order. The index comes from geometry
    // (nearest item midpoint) rather than the single hovered row, so landing in
    // a gap or on blank space inserts next to the closest item instead of
    // snapping to the bottom.
    const index = topIndexAt(event);
    if (drag.topIndex >= 0 && (index === drag.topIndex || index === drag.topIndex + 1)) {
      drop = null;
      return;
    }
    drop = { kind: 'top', index };
  }

  /** Top-level insertion index for the pointer's Y (nearest item midpoint). */
  function topIndexAt(event: DragEvent): number {
    if (!listEl) return topItems.length;
    const rows = listEl.querySelectorAll<HTMLElement>('[data-top-index]');
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        return Number(row.dataset.topIndex);
      }
    }
    return rows.length;
  }

  function onDrop(event: DragEvent): void {
    if (!drag) return;
    event.preventDefault();
    const cur = drag;
    const target = drop;
    const order = topItems.map((t) => t.id);
    endDrag();
    if (!target) return;

    if (target.kind === 'folder') {
      if (cur.kind === 'playlist') void movePlaylistToFolder(cur.id, target.folderId, order);
      return;
    }
    if (target.kind === 'in-folder') {
      const entry = topItems.find(
        (t) => t.type === 'folder' && t.folder.id === target.folderId,
      );
      const beforeId =
        entry && entry.type === 'folder' ? entry.items[target.index]?.browseId ?? null : null;
      if (cur.kind === 'playlist') void movePlaylist(cur.id, target.folderId, beforeId, order);
      return;
    }
    // top-level
    const beforeId = topItems[target.index]?.id ?? null;
    if (cur.kind === 'playlist') void movePlaylist(cur.id, null, beforeId, order);
    else void reorderFolder(cur.id, beforeId, order);
  }

  // ── Compact-mode hover tooltip ──────────────────────────────────
  let tip = { show: false, x: 0, y: 0, title: '', author: '' };
  function showTip(event: MouseEvent, title: string, author = ''): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tip = {
      show: true,
      x: rect.right + 8,
      y: rect.top + rect.height / 2,
      title,
      author,
    };
  }
  function hideTip(): void {
    tip = { ...tip, show: false };
  }

  // ── Expanded sidebar width (drag the right edge) ────────────────
  const SIDEBAR_MIN = 176;
  const SIDEBAR_MAX = 440;
  let sidebarWidth = $settingsStore.sidebarWidth || 240;
  $: sidebarWidth = $settingsStore.sidebarWidth || 240;

  // Held so an in-progress resize can be torn down if the rail unmounts (e.g.
  // sign-out or a layout change) instead of leaking the window listeners.
  let resizeCleanup: (() => void) | null = null;
  onDestroy(() => resizeCleanup?.());

  function startResize(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e: MouseEvent) => {
      sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + e.clientX - startX));
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeCleanup = null;
    };
    const onUp = () => {
      cleanup();
      void updateSettings({ sidebarWidth });
    };
    resizeCleanup = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Hide the top fade at the very top and the bottom fade at the very end, so
  // neither covers the first/last playlist when there is nothing to trail off.
  let atBottom = false;
  let atTop = true;
  let listEl: HTMLDivElement | undefined;
  function updateBottom() {
    if (!listEl) return;
    atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 8;
    atTop = listEl.scrollTop < 8;
  }
  $: if (listEl) {
    void $playlistStore;
    void $foldersStore;
    void $libraryLoading;
    // The list height also changes when the order, pins or open folders change.
    void $sidebarOrderStore;
    void $pinnedStore;
    void $collapsedFolders;
    queueMicrotask(updateBottom);
  }

  // ── Row snippets ────────────────────────────────────────────────
  // `topIndex >= 0` marks a top-level row; otherwise it lives in `folderId` at
  // `childIndex`.
  const rowClass =
    'flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-white';
</script>

{#snippet row(playlist: Playlist, topIndex: number, folderId: string | null, childIndex: number)}
  {#if compact}
    <div class="relative flex justify-center">
      <button
        class="relative h-10 w-10 overflow-hidden rounded-lg bg-white/5 transition {pinnedIds.has(
          playlist.browseId,
        )
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing'} {drag?.kind ===
        'playlist' && drag?.id === playlist.browseId
          ? 'opacity-40'
          : ''}"
        aria-label={playlist.title}
        draggable={!pinnedIds.has(playlist.browseId)}
        ondragstart={(e) => startPlaylistDrag(e, playlist.browseId, topIndex, folderId, childIndex)}
        ondragend={endDrag}
        onclick={() => openPlaylist(playlist)}
        oncontextmenu={(e) => openContextMenu(e, playlistMenu(playlist, { pin: true }))}
        onmouseenter={(e) => showTip(e, playlist.title, playlist.author ?? '')}
        onmouseleave={hideTip}
      >
        {#if playlist.thumbnails[0]}
          <img src={playlist.thumbnails[0].url} alt="" class="h-full w-full object-cover" loading="lazy" />
        {:else}
          <span class="flex h-full w-full items-center justify-center text-[var(--color-accent2)]">
            <i class="bx bx-music"></i>
          </span>
        {/if}
        {#if pinnedIds.has(playlist.browseId)}
          <span
            class="pointer-events-none absolute bottom-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[9px] leading-none text-white"
          >
            <i class="bx bxs-pin translate-y-[0.5px]"></i>
          </span>
        {/if}
      </button>
    </div>
  {:else}
    <div class="relative flex items-center {folderId ? 'mx-1' : 'mx-2'}">
      <button
        class="{rowClass} {pinnedIds.has(playlist.browseId)
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing'} {drag?.kind === 'playlist' && drag?.id === playlist.browseId
          ? 'opacity-40'
          : ''}"
        title={playlist.title}
        draggable={!pinnedIds.has(playlist.browseId)}
        ondragstart={(e) => startPlaylistDrag(e, playlist.browseId, topIndex, folderId, childIndex)}
        ondragend={endDrag}
        onclick={() => openPlaylist(playlist)}
        oncontextmenu={(e) => openContextMenu(e, playlistMenu(playlist, { pin: true }))}
      >
        <span class="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white/5">
          {#if playlist.thumbnails[0]}
            <img src={playlist.thumbnails[0].url} alt="" class="h-full w-full object-cover" loading="lazy" />
          {:else}
            <span class="flex h-full w-full items-center justify-center text-[11px] text-[var(--color-accent2)]">
              <i class="bx bx-music"></i>
            </span>
          {/if}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate leading-tight">{playlist.title}</span>
          {#if playlist.author}
            <span class="mt-0.5 block truncate text-[11px] leading-tight text-zinc-500">{playlist.author}</span>
          {/if}
        </span>
        {#if pinnedIds.has(playlist.browseId)}
          <i class="bx bxs-pin shrink-0 text-[11px] text-[var(--color-accent2)]" title="Pinned"></i>
        {/if}
      </button>
    </div>
  {/if}
{/snippet}

{#snippet folderChildren(folder: PlaylistFolder, items: Playlist[])}
  {#each items as playlist, j (playlist.browseId)}
    <div
      class="relative"
      data-child-id={playlist.browseId}
      data-child-index={j}
      data-folder={folder.id}
      animate:flip={{ duration: 180 }}
    >
      {#if drop?.kind === 'in-folder' && drop?.folderId === folder.id && drop?.index === j}
        <span
          class="pointer-events-none absolute inset-x-2 -top-0.5 z-10 h-0.5 rounded-full bg-[var(--color-accent)]"
          transition:fade={{ duration: 120 }}
        ></span>
      {/if}
      {@render row(playlist, -1, folder.id, j)}
    </div>
  {/each}
  {#if drop?.kind === 'in-folder' && drop?.folderId === folder.id && drop?.index === items.length}
    <div
      class="mx-2 h-0.5 shrink-0 rounded-full bg-[var(--color-accent)]"
      transition:fade={{ duration: 120 }}
    ></div>
  {/if}
{/snippet}

{#snippet folderBlock(folder: PlaylistFolder, items: Playlist[], topIndex: number)}
  {#if compact}
    <!-- Compact: the icon and its members share one outlined block. -->
    <div
      class="mx-auto flex w-fit flex-col items-center gap-1 rounded-xl {!$collapsedFolders.has(
        folder.id,
      ) && items.length > 0
        ? 'border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.18] p-1'
        : ''}"
    >
      <div class="relative flex justify-center">
        <button
          class="flex h-10 w-10 cursor-grab items-center justify-center rounded-lg text-xl transition active:cursor-grabbing {drop?.kind ===
          'folder' && drop?.folderId === folder.id
            ? 'bg-[var(--color-accent)]/35 text-white ring-2 ring-[var(--color-accent)]/50'
            : 'bg-white/5 text-[var(--color-accent2)]'} {drag?.kind === 'folder' &&
          drag?.id === folder.id
            ? 'opacity-40'
            : ''}"
          aria-label={folder.name}
          draggable="true"
          data-folder-header={folder.id}
          ondragstart={(e) => startFolderDrag(e, folder.id, topIndex)}
          ondragend={endDrag}
          onclick={() => toggleFolder(folder.id)}
          oncontextmenu={(e) => openContextMenu(e, folderMenu(folder))}
          onmouseenter={(e) => showTip(e, folder.name, `${items.length} playlists`)}
          onmouseleave={hideTip}
        >
          <i class="bx {drop?.kind === 'folder' && drop?.folderId === folder.id ? 'bxs-folder-open' : 'bxs-folder'}"></i>
        </button>
      </div>
      {#if !$collapsedFolders.has(folder.id) && items.length > 0}
        <div
          class="flex flex-col items-stretch gap-2"
          data-child-zone={folder.id}
          data-child-count={items.length}
          transition:slide={{ duration: 160 }}
        >
          {@render folderChildren(folder, items)}
        </div>
      {/if}
    </div>
  {:else}
    <div class="relative mx-2 flex items-center">
      <button
        class="{rowClass} cursor-grab text-zinc-300 active:cursor-grabbing {drop?.kind === 'folder' && drop?.folderId === folder.id
          ? 'bg-[var(--color-accent)]/10 ring-2 ring-[var(--color-accent)]/60'
          : ''} {drag?.kind === 'folder' && drag?.id === folder.id ? 'opacity-40' : ''}"
        title={folder.name}
        draggable="true"
        data-folder-header={folder.id}
        ondragstart={(e) => startFolderDrag(e, folder.id, topIndex)}
        ondragend={endDrag}
        onclick={() => toggleFolder(folder.id)}
        oncontextmenu={(e) => openContextMenu(e, folderMenu(folder))}
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md {drop?.kind === 'folder' &&
          drop?.folderId === folder.id
            ? 'bg-[var(--color-accent)]/25 text-[var(--color-accent2)]'
            : 'bg-white/5 text-[var(--color-accent2)]'}"
        >
          <i class="bx {drop?.kind === 'folder' && drop?.folderId === folder.id ? 'bxs-folder-open' : 'bxs-folder'}"></i>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{folder.name}</span>
          <span class="mt-0.5 block text-[10px] text-zinc-600">
            {drop?.kind === 'folder' && drop?.folderId === folder.id ? 'Drop to add' : `${items.length} playlists`}
          </span>
        </span>
        <i
          class="bx {$collapsedFolders.has(folder.id)
            ? 'bx-chevron-right'
            : 'bx-chevron-down'} shrink-0 text-base text-zinc-500"
        ></i>
      </button>
    </div>

    {#if !$collapsedFolders.has(folder.id)}
      {#if items.length > 0}
        <div
          class="mx-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.12]"
          data-child-zone={folder.id}
          data-child-count={items.length}
          transition:slide={{ duration: 160 }}
        >
          {@render folderChildren(folder, items)}
        </div>
      {:else}
        <p class="mx-2 ml-12 py-1 text-[11px] text-zinc-600">Empty — drag a playlist here.</p>
      {/if}
    {/if}
  {/if}
{/snippet}

<aside
  class="relative flex h-full shrink-0 flex-col {forceFull
    ? 'w-full bg-[var(--color-surface)]/95 pt-12'
    : compact
      ? 'cherry-sidebar w-14 pt-2'
      : 'cherry-sidebar pt-1'}"
  style={!compact && !forceFull ? `width: ${sidebarWidth}px` : ''}
>
  {#if !compact && !forceFull}
    <!-- Drag handle on the right edge resizes the expanded sidebar. -->
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
    <div
      class="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize transition-colors hover:bg-[var(--color-accent)]/50"
      role="separator"
      aria-label="Resize sidebar"
      onmousedown={startResize}
    ></div>
  {/if}

  <!-- Navigation + actions: one vertical stack shared by both layouts. Compact
       shows icons only (with hover tooltips); the expanded sidebar adds labels
       and can be resized by dragging its right edge. -->
  {#if compact}
    <div class="relative z-20 flex shrink-0 flex-col items-center gap-2">
      <button
        class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/[0.06]"
        aria-label="Back"
        disabled={!$canGoBack}
        onclick={back}
        onmouseenter={(e) => showTip(e, 'Back')}
        onmouseleave={hideTip}
      >
        <i class="bx bx-chevron-left text-3xl"></i>
      </button>
      <button
        class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Home"
        onclick={() => go('home')}
        onmouseenter={(e) => showTip(e, 'Home')}
        onmouseleave={hideTip}
      >
        <i class="bx bx-home"></i>
      </button>
      <button
        class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Search"
        onclick={() => go('search')}
        onmouseenter={(e) => showTip(e, 'Search')}
        onmouseleave={hideTip}
      >
        <i class="bx bx-search"></i>
      </button>
      <button
        class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="New playlist or folder"
        onclick={openNewMenu}
        onmouseenter={(e) => showTip(e, 'New playlist or folder')}
        onmouseleave={hideTip}
      >
        <i class="bx bx-plus text-2xl"></i>
      </button>
    </div>
  {:else}
    <div class="relative z-20 flex shrink-0 flex-col gap-0.5 px-2">
      {#if !forceFull}
        <button
          class="flex items-center gap-2 rounded-lg py-1 text-left text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Back"
          disabled={!$canGoBack}
          onclick={back}
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 text-zinc-300">
            <i class="bx bx-chevron-left text-2xl"></i>
          </span>
          <span class="truncate">Back</span>
        </button>
      {/if}
      <button
        class="flex items-center gap-2 rounded-lg py-1 text-left text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
        aria-label="Home"
        onclick={() => go('home')}
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 text-zinc-300">
          <i class="bx bx-home text-xl"></i>
        </span>
        <span class="truncate">Home</span>
      </button>
      <button
        class="flex items-center gap-2 rounded-lg py-1 text-left text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
        aria-label="Search"
        onclick={() => go('search')}
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 text-zinc-300">
          <i class="bx bx-search text-xl"></i>
        </span>
        <span class="truncate">Search</span>
      </button>
      <button
        class="flex items-center gap-2 rounded-lg py-1 text-left text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-white"
        aria-label="New playlist or folder"
        onclick={openNewMenu}
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5 text-zinc-300">
          <i class="bx bx-plus text-2xl"></i>
        </span>
        <span class="truncate">New</span>
      </button>
    </div>
  {/if}

  <div class="relative flex min-h-0 flex-1 flex-col {compact ? 'mt-2' : ''}">
    <!-- Fade the top so playlists trail off as they scroll up under the nav —
         anchored behind the last button (like the account gradient). Hidden at
         the very top so it never covers the first playlist. -->
    <div
      class="pointer-events-none absolute inset-x-0 -top-12 z-10 h-24 bg-gradient-to-b from-transparent via-[var(--color-popover)] to-transparent transition-opacity duration-200 {atTop
        ? 'opacity-0'
        : 'opacity-100'}"
    ></div>
    <div
      bind:this={listEl}
      use:overlayScrollbar={{ enabled: !compact }}
      class="cherry-overlay-scroll flex min-h-0 flex-1 flex-col pb-2 {compact
        ? 'items-stretch gap-2'
        : 'gap-0.5'}"
      role="list"
      onscroll={updateBottom}
      ondragover={onDragOver}
      ondrop={onDrop}
      ondragend={endDrag}
    >
    {#if !$authStore}
      <p class="mx-2 py-2 text-[11px] leading-relaxed text-zinc-600">
        Sign in with YouTube Music in Settings to load your playlists.
      </p>
    {:else if $libraryLoading}
      <p class="mx-2 py-2 text-[11px] text-zinc-600">Loading library…</p>
    {:else if $playlistStore.length === 0}
      <div class="mx-2 py-2 text-[11px] leading-relaxed text-zinc-600">
        <p>{$libraryLoading ? 'Loading library…' : 'No playlists loaded.'}</p>
        {#if $libraryError}<p class="mt-1 text-rose-300/80">{$libraryError}</p>{/if}
        {#if !$libraryLoading}
          <button
            class="mt-1 text-[var(--color-accent2)] underline disabled:opacity-40"
            disabled={$libraryLoading}
            onclick={() => refreshLibrary()}
          >
            Retry
          </button>
        {/if}
      </div>
    {:else}
      {#each topItems as item, i (item.id)}
        <div
          class="relative"
          data-top-id={item.id}
          data-top-index={i}
          animate:flip={{ duration: 180 }}
        >
          {#if drop?.kind === 'top' && drop?.index === i}
            <span
              class="pointer-events-none absolute inset-x-2 -top-0.5 z-10 h-0.5 rounded-full bg-[var(--color-accent)]"
              transition:fade={{ duration: 120 }}
            ></span>
          {/if}
          {#if item.type === 'folder'}
            {@render folderBlock(item.folder, item.items, i)}
          {:else}
            {@render row(item.playlist, i, null, -1)}
          {/if}
        </div>
      {/each}
      {#if drop?.kind === 'top' && drop?.index === topItems.length}
        <div
          class="mx-2 h-0.5 shrink-0 rounded-full bg-[var(--color-accent)]"
          transition:fade={{ duration: 120 }}
        ></div>
      {/if}
    {/if}
    </div>
  </div>

  <!-- Fade the bottom of the rail so the list trails off, matching the top. -->
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-[var(--color-popover)] via-[var(--color-popover)]/60 to-transparent transition-opacity duration-200 {atBottom
      ? 'opacity-0'
      : 'opacity-100'}"
  ></div>
</aside>

{#if tip.show}
  <div
    class="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-lg border border-white/10 bg-[var(--color-elevated)] px-3 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.55)]"
    style="left: {tip.x}px; top: {tip.y}px;"
  >
    <div class="text-[12px] font-medium text-white">{tip.title}</div>
    {#if tip.author}<div class="text-[10px] text-zinc-500">{tip.author}</div>{/if}
  </div>
{/if}
