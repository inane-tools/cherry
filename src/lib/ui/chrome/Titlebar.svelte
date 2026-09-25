<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { isTauri } from '$lib/app/services/platform';
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { pinnedStore, openPinned } from '$lib/app/services/pins';
  import { back, canGoBack, go } from '$lib/app/services/navigation';

  /**
   * Signed-out / welcome view: keep only the native window controls (and the
   * draggable bar), hiding the nav icons, pins and account button, which have
   * nothing to act on without a session.
   */
  export let minimal = false;

  let maximized = false;

  $: profile = $activeChannelStore;
  $: accountName = profile?.name || $authStore?.accountLabel || 'Guest';
  $: initial = accountName.trim().charAt(0).toUpperCase() || 'G';

  if (isTauri()) {
    void getCurrentWindow()
      .isMaximized()
      .then((value) => (maximized = value))
      .catch(() => undefined);
  }

  async function minimize() {
    if (isTauri()) await getCurrentWindow().minimize();
  }
  async function toggleMaximize() {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize();
    maximized = await getCurrentWindow().isMaximized().catch(() => maximized);
  }
  async function close() {
    if (isTauri()) await getCurrentWindow().close();
  }

  async function onBarMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !isTauri()) return;
    const t = e.target;
    if (t instanceof Element && t.closest('button, input, form, a')) return;
    e.preventDefault();
    // The second press of a double-click must maximize/restore. startDragging()
    // on the first press hands the mouse to the OS (which ends on mouseup), so
    // the native dblclick event is never delivered — the press count has to be
    // checked here instead.
    if (e.detail === 2) {
      await toggleMaximize();
      return;
    }
    await getCurrentWindow().startDragging().catch(() => undefined);
  }
</script>

<!-- The header is the OS window drag handle: dragging moves the window and a
     double-click maximizes/restores it. -->
<!-- svelte-ignore a11y_no_static_element_interactions : header starts a native window drag -->
<!-- `z-40` keeps the whole bar (drag region + icons) above the sign-in gate,
     which covers everything below it. -->
<header
  onmousedown={onBarMouseDown}
  class="absolute inset-x-0 top-0 z-40 flex h-12 items-center gap-2 pl-2"
>
  <!-- Left: back, home, explore, then pinned playlists. Hidden on the welcome
       screen, where none of them have anything to act on. -->
  {#if !minimal}
    <div class="flex min-w-0 items-center gap-2 overflow-hidden">
    <button
      class="cherry-btn-scrim flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg text-white backdrop-blur-md transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/5"
      title="Back"
      aria-label="Back"
      disabled={!$canGoBack}
      onclick={back}
    >
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <button
      class="cherry-btn-scrim flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg text-white backdrop-blur-md transition-colors hover:bg-white/10"
      title="Home"
      aria-label="Home"
      onclick={() => go('home')}
    >
      <i class="bx bx-home-alt-2"></i>
    </button>
    <button
      class="cherry-btn-scrim flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg text-white backdrop-blur-md transition-colors hover:bg-white/10"
      title="Explore"
      aria-label="Explore"
      onclick={() => go('explore')}
    >
      <i class="bx bx-compass"></i>
    </button>

    {#each $pinnedStore as pin (pin.browseId)}
      <button
        class="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[var(--color-accent)]/70"
        title={pin.title}
        aria-label={pin.title}
        onclick={() => openPinned(pin)}
      >
        <!-- Fallback sits underneath: if the artwork URL has expired the image
             hides itself and the icon shows through. -->
        <span class="flex h-full w-full items-center justify-center text-sm text-[var(--color-accent2)]">
          <i class="bx bx-music"></i>
        </span>
        {#if pin.thumbnail}
          <img
            src={pin.thumbnail}
            alt=""
            class="absolute inset-0 h-full w-full object-cover"
            onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        {/if}
      </button>
    {/each}
    </div>
  {/if}

  <!-- Right: account + native window controls -->
  <div class="ml-auto flex h-full shrink-0 items-center justify-end gap-2">
    {#if !minimal}
      <button
        class="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[var(--color-accent)]/70"
        title={accountName}
        aria-label="Account settings"
        onclick={() => go('settings')}
      >
        {#if profile?.avatarUrl}
          <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-[11px] font-bold text-[#181820]">{initial}</span>
        {/if}
      </button>
    {/if}

    {#if isTauri()}
      <!-- Native Windows caption buttons: Segoe system glyphs
           (E921 minimise, E922 maximise, E923 restore, E8BB close).
           `z-40` keeps them clickable above the sign-in gate, which covers the
           rest of the window. -->
      <div class="relative z-40 flex h-full items-stretch" data-tauri-drag-region>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title="Minimize"
          aria-label="Minimize"
          onclick={minimize}
        >
          <span class="win-glyph">&#xE921;</span>
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onclick={toggleMaximize}
        >
          <span class="win-glyph">{maximized ? '\uE923' : '\uE922'}</span>
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-[#c42b1c]"
          title="Close"
          aria-label="Close"
          onclick={close}
        >
          <span class="win-glyph text-[11px]">&#xE8BB;</span>
        </button>
      </div>
    {/if}
  </div>
</header>
