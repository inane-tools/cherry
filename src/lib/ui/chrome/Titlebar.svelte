<script lang="ts">
  import { getCurrentWindow } from '$lib/desktop/window';
  import { onMount } from 'svelte';
  import { isDesktop, isMacDesktop, isLinuxDesktop } from '$lib/app/services/platform';
  import { nativeTitlebar, trackTitlebarOffset } from '$lib/app/services/nativeTitlebar';
  import { settingsStore } from '$lib/app/services/settings';
  import { activeChannelStore } from '$lib/app/services/account';
  import { back, canGoBack, pageStore, type Page } from '$lib/app/services/navigation';
  import { thumbnailSources, type Thumbnail } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import logoUrl from '$lib/assets/logo.png';
  import { fade } from '$lib/ui/transitions';
  import { playerExpanded, sidebarDrawerOpen } from '$lib/app/services/layout';
  import { settingsOpen, searchOpen } from '$lib/app/services/overlays';
  import { homeSectionsStore, openPlaylistHeaderLoading, openPlaylistStore } from '$lib/app/services/playlists';
  import { repeatListening } from '$lib/core/profileSections';
  import { repeatListeningStore } from '$lib/app/services/profilePersonalization';

  import { homeGreeting as makeHomeGreeting } from '$lib/core/homeGreeting';

  let hour = new Date().getHours();
  let greetingSeed = { personal: 1, line: Math.random() };
  let previousGreeting = '';
  let visitedHome = false;
  onMount(() => {
    let previousView: Page['view'] | undefined;
    // Includes Back navigation, but not pressing Home while already there.
    // Exclude the previous line so each visit actually changes the greeting.
    const stop = pageStore.subscribe(page => {
      const enteringHome = page.view === 'home' && previousView !== 'home';
      previousView = page.view;
      if (!enteringHome) return;
      previousGreeting = homeGreeting;
      greetingSeed = { personal: visitedHome ? Math.random() : 1, line: Math.random() };
      visitedHome = true;
      hour = new Date().getHours();
    });
    const timer = setInterval(() => { hour = new Date().getHours(); }, 60_000);
    return () => { clearInterval(timer); stop(); };
  });
  $: firstName = ($activeChannelStore?.name ?? '').trim().split(/\s+/)[0] ?? '';
  $: homeListening = repeatListening($homeSectionsStore);
  $: listening = {
    artists: [...new Set([...homeListening.artists, ...$repeatListeningStore.artists])],
    songs: [...new Set([...homeListening.songs, ...$repeatListeningStore.songs])],
    playlists: [...new Set([...homeListening.playlists, ...$repeatListeningStore.playlists])],
  };
  $: homeGreeting = makeHomeGreeting(hour, firstName, listening, greetingSeed, previousGreeting);

  function describePage(page: Page, homeGreeting: string): { title: string; detail: string; icon: string; thumbnails: Thumbnail[] } {
    switch (page.view) {
      case 'home': return { title: homeGreeting, detail: 'Home', icon: 'ph-fill ph-house', thumbnails: [] };
      case 'explore': return { title: 'Discover new music', detail: 'Explore', icon: 'ph-fill ph-compass', thumbnails: [] };
      case 'playlist': return { title: page.entity.title, detail: ['Playlist', page.entity.author].filter(Boolean).join(' · '), icon: 'ph-fill ph-playlist', thumbnails: page.entity.thumbnails };
      case 'album': return { title: page.entity.title, detail: ['Album', page.entity.artists.map(artist => artist.name).join(', '), page.entity.year].filter(Boolean).join(' · '), icon: 'ph-fill ph-vinyl-record', thumbnails: page.entity.thumbnails };
      case 'artist': return { title: page.entity.name, detail: 'Artist', icon: 'ph-fill ph-user', thumbnails: page.entity.thumbnails ?? [] };
      case 'browse': return { title: page.entity.title, detail: page.entity.kind === 'profile' ? 'Profile' : page.entity.kind === 'mix' ? 'Mix' : 'Explore', icon: page.entity.kind === 'profile' ? 'ph-fill ph-user' : page.entity.kind === 'mix' ? 'ph-fill ph-play-circle' : 'ph-fill ph-compass', thumbnails: page.entity.thumbnails ?? [] };
      case 'search': return { title: 'Search', detail: 'Find music', icon: 'ph-fill ph-magnifying-glass', thumbnails: [] };
      case 'settings': return { title: 'Settings', detail: 'Cherry preferences', icon: 'ph-fill ph-gear-six', thumbnails: [] };
    }
  }
  $: heading = describePage($pageStore, homeGreeting);
  $: headingArtwork = thumbnailSources(heading.thumbnails, 64);
  $: loadingHeading = $pageStore.view === 'playlist' && $openPlaylistStore?.browseId === $pageStore.entity.browseId && $openPlaylistHeaderLoading;

  /**
   * Signed-out / welcome view: keep only the native window controls (and the
   * draggable bar), hiding the menu button, which has nothing to act on without
   * a session.
   */
  export let minimal = false;
  export let scrolled = false;
  export let showBackdrop = true;
  /** Narrow layout: show the hamburger that opens the sidebar drawer. */
  export let narrow = false;
  export let drawerVisible = false;
  export let onMenu: () => void = () => {};

  let windows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
  let macos = isMacDesktop();
  let linux = isLinuxDesktop();
  type CaptionButton = 'minimize' | 'maximize' | 'close';
  $: hasLeftControls = $settingsStore.windowControls && (macos || (linux && $nativeTitlebar.left > 0));
  let maximized = false;
  onMount(() => {
    let disposed = false;
    let stop = () => {};
    void (async () => {
      if (!isDesktop() || disposed) return;
      const platform = await window.cherryDesktop?.invoke<string>('desktop_platform');
      windows = platform === 'windows';
      macos = platform === 'macos';
      linux = platform === 'linux';
      const win = getCurrentWindow();
      maximized = await win.isMaximized();
      const unlisten = await win.onResized(() => { void win.isMaximized().then(value => { if (!disposed) maximized = value; }); });
      if (disposed) unlisten(); else stop = unlisten;
    })().catch(console.error);
    return () => { disposed = true; stop(); };
  });

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

{#snippet captions(buttons: CaptionButton[])}
  {#if buttons.length}
    <div class="relative z-40 flex h-full shrink-0 items-stretch" class:win-caption={windows} data-desktop-drag-region>
      {#each buttons as button}
        <button class="caption-button flex w-[46px] items-center justify-center text-white {button === 'close' ? 'caption-close hover:bg-[#c42b1c]' : 'hover:bg-white/10'}"
          title={button === 'minimize' ? 'Minimize' : button === 'close' ? 'Close' : maximized ? 'Restore' : 'Maximize'}
          aria-label={button === 'minimize' ? 'Minimize' : button === 'close' ? 'Close' : maximized ? 'Restore' : 'Maximize'}
          onclick={button === 'minimize' ? minimize : button === 'close' ? close : toggleMaximize}>
          {#if windows}<span class="win-glyph" aria-hidden="true">{button === 'minimize' ? '\uE921' : button === 'close' ? '\uE8BB' : maximized ? '\uE923' : '\uE922'}</span>
          {:else}<i class={button === 'minimize' ? 'ph ph-minus text-lg' : button === 'close' ? 'ph ph-x text-xl' : maximized ? 'ph ph-copy text-sm' : 'ph ph-square text-sm'} aria-hidden="true"></i>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- The header is the OS window drag handle: dragging moves the window and a
     double-click maximizes/restores it. -->
<!-- svelte-ignore a11y_no_static_element_interactions : header starts a native window drag -->
<!-- Navigation sits below modal backdrops; account/window controls stay above. -->
<header
  use:trackTitlebarOffset
  data-desktop-drag-region
  class:macos
  class:has-left-controls={hasLeftControls}
  class:linux-native={linux}
  style:padding-left={hasLeftControls ? macos ? 'var(--mac-titlebar-inset)' : 'calc(var(--native-controls-left, 0px) + 8px)' : undefined}
  class="absolute inset-x-0 top-0 flex h-12 items-center gap-2"
>
  {#if !minimal && (scrolled || $playerExpanded) && showBackdrop}
    <div class="cherry-topbar-backdrop" aria-hidden="true" transition:fade={{ duration: 160 }}></div>
  {/if}
  <!-- Navigation and page identity stay together in both sidebar layouts. -->
  {#if !minimal}
    <div class="cherry-topbar-navigation relative flex min-w-0 flex-1 items-center gap-2 {narrow && drawerVisible && !$settingsOpen && !$searchOpen ? 'z-40' : 'z-20'}">
      <div class="cherry-topbar-back-slot flex h-full shrink-0 items-center justify-center">
      <button
        class="cherry-nav-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white transition-colors disabled:cursor-default disabled:opacity-40"
        title="Back" aria-label="Back" disabled={!$canGoBack && !$playerExpanded}
        onclick={() => { if ($playerExpanded) playerExpanded.set(false); else back(); }}
      >
        <i class="ph ph-caret-left block leading-none" aria-hidden="true"></i>
      </button>
      </div>
      {#if narrow && !$playerExpanded}
        <button
          class="cherry-nav-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white transition-colors"
          title={$sidebarDrawerOpen ? 'Close menu' : 'Open menu'} aria-label={$sidebarDrawerOpen ? 'Close menu' : 'Open menu'} aria-expanded={$sidebarDrawerOpen} onclick={onMenu}
        >
          <i class="ph ph-list block leading-none" aria-hidden="true"></i>
        </button>
      {/if}
      <div class="cherry-topbar-identity flex min-w-0 flex-1 items-center gap-2" aria-label="Current page">
        {#if $pageStore.view === 'home' || $pageStore.view === 'explore' || ($pageStore.view === 'browse' && !$pageStore.entity.kind)}
          <img src={logoUrl} alt="" draggable="false" class="h-8 w-8 shrink-0" />
        {:else if headingArtwork.length}
          <img use:artwork={{ urls: headingArtwork }} alt="" draggable="false" class="h-8 w-8 shrink-0 object-cover {$pageStore.view === 'artist' || ($pageStore.view === 'browse' && $pageStore.entity.kind === 'profile') ? 'rounded-full' : 'rounded-md'}" />
        {:else}
          <span class="flex h-8 w-8 shrink-0 items-center justify-center text-[28px] leading-none text-white" aria-hidden="true">
            <i class="{heading.icon} block leading-none"></i>
          </span>
        {/if}
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold leading-tight text-white" title={heading.title}>{heading.title}</div>
          <div class="mt-0.5 truncate text-[10px] leading-tight text-zinc-400" title={loadingHeading ? undefined : heading.detail}>
            {#if loadingHeading}<span class="inline-block h-2 w-24 rounded-full bg-white/5 motion-safe:animate-pulse" aria-label="Loading details"></span>{:else}{heading.detail}{/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Right: account + native window controls. -->
  <div class="cherry-topbar-actions relative z-40 ml-auto flex h-full shrink-0 items-center justify-end gap-2 {!macos && (!isDesktop() || !$settingsStore.windowControls || linux) ? 'pr-3' : ''}">
    {#if isDesktop() && windows && $settingsStore.windowControls}
      {@render captions(['minimize', 'maximize', 'close'])}
    {/if}
  </div>
</header>

<style>
  .cherry-topbar-back-slot { width: 40px; justify-content: flex-end; }
  header.has-left-controls .cherry-topbar-back-slot { width: 32px; }
  /* Compact sidebar without left-side window controls (Windows, most Linux):
     the back button sits over the sidebar's icon column and the page title
     starts on the content's left edge, so the top-left lines up with the
     layout below instead of hugging the window edge. */
  :global(.cherry-shell[data-sidebar-layout='compact']) header:not(.has-left-controls) .cherry-topbar-navigation { gap: 24px; }
  :global(.cherry-shell[data-sidebar-layout='compact']) header:not(.has-left-controls) .cherry-topbar-back-slot {
    width: var(--cherry-sidebar-inset, 40px);
    justify-content: center;
  }
  .caption-close:hover { color: white; }
  header.linux-native { padding-right: var(--native-controls-right, 0px); }

  header.macos {
    padding-right: 16px;
    gap: 16px;
  }
  header.macos .cherry-topbar-navigation { gap: 8px; }
  header.macos .cherry-topbar-identity { gap: 10px; }
  header.macos .cherry-topbar-actions { gap: 12px; }
</style>
