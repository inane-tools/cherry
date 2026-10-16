<script lang="ts">
  import { getCurrentWindow } from '$lib/desktop/window';
  import { onMount, tick } from 'svelte';
  import { isDesktop } from '$lib/app/services/platform';
  import { settingsStore } from '$lib/app/services/settings';
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { back, canGoBack, go } from '$lib/app/services/navigation';
  import { updateStore } from '$lib/app/services/updates';

  async function showUpdates() {
    go('settings');
    await tick();
    document.getElementById('cherry-updates')?.scrollIntoView({ block: 'center' });
  }

  /**
   * Signed-out / welcome view: keep only the native window controls (and the
   * draggable bar), hiding the menu button, which has nothing to act on without
   * a session.
   */
  export let minimal = false;
  /** Narrow layout: show the hamburger that opens the sidebar drawer. */
  export let narrow = false;
  export let onMenu: () => void = () => {};

  let maximized = false;
  onMount(() => {
    let disposed = false;
    let stop = () => {};
    void (async () => {
      if (!isDesktop() || disposed) return;
      const win = getCurrentWindow();
      maximized = await win.isMaximized();
      const unlisten = await win.onResized(() => { void win.isMaximized().then(value => { if (!disposed) maximized = value; }); });
      if (disposed) unlisten(); else stop = unlisten;
    })().catch(console.error);
    return () => { disposed = true; stop(); };
  });

  $: profile = $activeChannelStore;
  $: accountName = profile?.name || $authStore?.accountLabel || 'Guest';
  $: initial = accountName.trim().charAt(0).toUpperCase() || 'G';

  if (isDesktop()) {
    void getCurrentWindow()
      .isMaximized()
      .then((value) => (maximized = value))
      .catch(() => undefined);
  }

  async function minimize() {
    if (isDesktop()) await getCurrentWindow().minimize();
  }
  async function toggleMaximize() {
    if (!isDesktop()) return;
    await getCurrentWindow().toggleMaximize();
    maximized = await getCurrentWindow().isMaximized().catch(() => maximized);
  }
  async function close() {
    if (isDesktop()) await getCurrentWindow().close();
  }

</script>

<!-- The header is the OS window drag handle: dragging moves the window and a
     double-click maximizes/restores it. -->
<!-- svelte-ignore a11y_no_static_element_interactions : header starts a native window drag -->
<!-- `z-40` keeps the whole bar (drag region + icons) above the sign-in gate,
     which covers everything below it. -->
<header
  data-desktop-drag-region
  class="absolute inset-x-0 top-0 z-40 flex h-12 items-center gap-2 pl-2"
>
  <!-- Left: back + menu, shown only in the narrow layout (where the sidebar is a
       drawer). Hidden on the welcome screen. -->
  {#if !minimal}
    <div class="flex min-w-0 items-center gap-2 overflow-hidden">
    {#if narrow}
      <button
        class="cherry-btn-scrim flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg text-white backdrop-blur-md transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/5"
        title="Back"
        aria-label="Back"
        disabled={!$canGoBack}
        onclick={back}
      >
        <i class="bx bx-chevron-left text-2xl"></i>
      </button>
      <button
        class="cherry-btn-scrim flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white backdrop-blur-md transition-colors hover:bg-white/10"
        title="Menu"
        aria-label="Open menu"
        onclick={onMenu}
      >
        <i class="bx bx-menu text-2xl"></i>
      </button>
    {/if}
    </div>
  {/if}

  <!-- Right: account + native window controls. -->
  <div class="ml-auto flex h-full shrink-0 items-center justify-end gap-2 {$settingsStore.windowControls ? '' : 'pr-3'}">
    {#if !minimal}
      {#if $updateStore.phase === 'available' || $updateStore.phase === 'ready'}
        <button
          class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-accent)]/15 px-2.5 text-[11px] font-semibold text-white hover:bg-[var(--color-accent)]/25 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          title={`Cherry ${$updateStore.version} ${$updateStore.phase === 'ready' ? 'is ready to install' : 'is available'}`}
          aria-label={`Cherry ${$updateStore.version} ${$updateStore.phase === 'ready' ? 'ready to install' : 'available'}`}
          onclick={showUpdates}
        >
          <i class="bx bx-up-arrow-circle text-base text-[var(--color-accent)]" aria-hidden="true"></i>
          <span>v{$updateStore.version}</span>
        </button>
      {/if}
      <button
        class="group relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--color-avatar)] transition-colors"
        title={accountName}
        aria-label="Account settings"
        onclick={() => go('settings')}
      >
        {#if profile?.avatarUrl}
          <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-[11px] font-bold text-[#181818]">{initial}</span>
        {/if}
        <span
          class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <i class="bx bx-cog text-base"></i>
        </span>
      </button>
    {/if}

    {#if isDesktop() && $settingsStore.windowControls}
      <!-- Native Windows caption buttons: Segoe system glyphs
           (E921 minimise, E922 maximise, E923 restore, E8BB close).
           `z-40` keeps them clickable above the sign-in gate, which covers the
           rest of the window. -->
      <div class="relative z-40 flex h-full items-stretch" data-desktop-drag-region>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title="Minimize"
          aria-label="Minimize"
          onclick={minimize}
        >
          <i class="bx bx-minus text-lg" aria-hidden="true"></i>
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onclick={toggleMaximize}
        >
          <i class="bx {maximized ? 'bx-windows' : 'bx-square'} text-sm" aria-hidden="true"></i>
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-[#c42b1c]"
          title="Close"
          aria-label="Close"
          onclick={close}
        >
          <i class="bx bx-x text-xl" aria-hidden="true"></i>
        </button>
      </div>
    {/if}
  </div>
</header>
