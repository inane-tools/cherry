<script lang="ts">
  import { getCurrentWindow } from '$lib/desktop/window';
  import { onMount, tick } from 'svelte';
  import { isDesktop } from '$lib/app/services/platform';
  import { settingsStore } from '$lib/app/services/settings';
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/account';
  import { back, canGoBack, go, pageStore, type Page } from '$lib/app/services/navigation';
  import { thumbnailSources, type Thumbnail } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import logoUrl from '$lib/assets/logo.png';
  import { fade } from '$lib/ui/transitions';
  import { updateStore } from '$lib/app/services/updates';
  import { sidebarDrawerOpen } from '$lib/app/services/layout';
  import { settingsOpen, searchOpen } from '$lib/app/services/overlays';
  import { homeSectionsStore, openPlaylistHeaderLoading, openPlaylistStore } from '$lib/app/services/playlists';
  import { repeatListening } from '$lib/core/profileSections';
  import { repeatListeningStore } from '$lib/app/services/profilePersonalization';

  import { homeGreeting as makeHomeGreeting } from '$lib/core/homeGreeting';
  import AppMenu from '$lib/ui/components/AppMenu.svelte';
  import { openProfile } from '$lib/app/services/browse';
  import { releaseCodename } from '$lib/app/services/release';

  let mainMenuOpen = false;
  let mainMenuAnchor: HTMLButtonElement;
  $: profileTarget = $homeSectionsStore.find(section => section.header?.profile)?.header?.profile
    ?? ($activeChannelStore?.pageId?.startsWith('UC') ? { browseId: $activeChannelStore.pageId } : undefined);
  function showProfile() {
    if (profileTarget) openProfile(profileTarget, accountName, profile?.avatarUrl ? [{ url: profile.avatarUrl }] : []);
  }

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
      case 'browse': return { title: page.entity.title, detail: page.entity.kind === 'profile' ? 'Profile' : 'Explore', icon: page.entity.kind === 'profile' ? 'ph-fill ph-user' : 'ph-fill ph-compass', thumbnails: page.entity.thumbnails ?? [] };
      case 'search': return { title: 'Search', detail: 'Find music', icon: 'ph-fill ph-magnifying-glass', thumbnails: [] };
      case 'settings': return { title: 'Settings', detail: 'Cherry preferences', icon: 'ph-fill ph-gear-six', thumbnails: [] };
    }
  }
  $: heading = describePage($pageStore, homeGreeting);
  $: headingArtwork = thumbnailSources(heading.thumbnails, 64);
  $: loadingHeading = $pageStore.view === 'playlist' && $openPlaylistStore?.browseId === $pageStore.entity.browseId && $openPlaylistHeaderLoading;

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
  export let scrolled = false;
  /** Narrow layout: show the hamburger that opens the sidebar drawer. */
  export let narrow = false;
  export let drawerVisible = false;
  export let onMenu: () => void = () => {};

  let windows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
  let maximized = false;
  onMount(() => {
    let disposed = false;
    let stop = () => {};
    void (async () => {
      if (!isDesktop() || disposed) return;
      windows = await window.cherryDesktop?.invoke<string>('desktop_platform') === 'windows';
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
<!-- Navigation sits below modal backdrops; account/window controls stay above. -->
<header
  data-desktop-drag-region
  class="absolute inset-x-0 top-0 flex h-12 items-center gap-2 pl-2"
>
  {#if !minimal && scrolled}
    <div class="cherry-topbar-backdrop" aria-hidden="true" transition:fade={{ duration: 160 }}></div>
  {/if}
  <!-- Navigation and page identity stay together in both sidebar layouts. -->
  {#if !minimal}
    <div class="relative flex min-w-0 flex-1 items-center gap-2 {narrow && drawerVisible && !$settingsOpen && !$searchOpen ? 'z-40' : 'z-20'}">
      <button
        class="cherry-nav-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white transition-colors disabled:cursor-default disabled:opacity-40"
        title="Back" aria-label="Back" disabled={!$canGoBack} onclick={back}
      >
        <i class="ph ph-caret-left block leading-none" aria-hidden="true"></i>
      </button>
      {#if narrow}
        <button
          class="cherry-nav-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-white transition-colors"
          title={$sidebarDrawerOpen ? 'Close menu' : 'Open menu'} aria-label={$sidebarDrawerOpen ? 'Close menu' : 'Open menu'} aria-expanded={$sidebarDrawerOpen} onclick={onMenu}
        >
          <i class="ph ph-list block leading-none" aria-hidden="true"></i>
        </button>
      {/if}
      <div class="flex min-w-0 flex-1 items-center gap-2" aria-label="Current page">
        {#if $pageStore.view === 'home' || $pageStore.view === 'explore' || ($pageStore.view === 'browse' && $pageStore.entity.kind !== 'profile')}
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
  <div class="relative z-40 ml-auto flex h-full shrink-0 items-center justify-end gap-2 {$settingsStore.windowControls ? '' : 'pr-3'}">
    {#if !minimal}
      {#if $updateStore.phase === 'available' || $updateStore.phase === 'ready'}
        <button
          class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-accent)]/15 px-2.5 text-[11px] font-semibold text-white hover:bg-[var(--color-accent)]/25 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          title={`Cherry ${$updateStore.version} ${$updateStore.phase === 'ready' ? 'is ready to install' : 'is available'}`}
          aria-label={`Cherry ${$updateStore.version} ${$updateStore.phase === 'ready' ? 'ready to install' : 'available'}`}
          onclick={showUpdates}
        >
          <i class="ph-fill ph-arrow-circle-up text-base text-[var(--color-accent)]" aria-hidden="true"></i>
          <span>v{$updateStore.version}</span>
        </button>
      {/if}
      <button
        bind:this={mainMenuAnchor}
        class="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent"
        title={accountName}
        aria-label="Main menu" aria-haspopup="menu" aria-expanded={mainMenuOpen}
        onclick={() => mainMenuOpen = !mainMenuOpen}
      >
        {#if profile?.avatarUrl}
          <img src={profile.avatarUrl} alt="" class="h-8 w-8 rounded-full bg-[var(--color-avatar)] object-cover" />
        {:else}
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-[11px] font-bold text-[#181818]">{initial}</span>
        {/if}
        <span
          class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <i class="ph ph-list text-base"></i>
        </span>
      </button>
    {/if}

    {#if isDesktop() && $settingsStore.windowControls}
      <!-- Native Windows caption buttons: Segoe system glyphs
           (E921 minimise, E922 maximise, E923 restore, E8BB close).
           `z-40` keeps them clickable above the sign-in gate, which covers the
           rest of the window. -->
      <div class="relative z-40 flex h-full items-stretch" class:win-caption={windows} data-desktop-drag-region>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title="Minimize"
          aria-label="Minimize"
          onclick={minimize}
        >
          {#if windows}<span class="win-glyph" aria-hidden="true">&#xE921;</span>{:else}<i class="ph ph-minus text-lg" aria-hidden="true"></i>{/if}
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-white/10"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onclick={toggleMaximize}
        >
          {#if windows}<span class="win-glyph" aria-hidden="true">{maximized ? '\uE923' : '\uE922'}</span>{:else}<i class="{maximized ? 'ph ph-copy' : 'ph ph-square'} text-sm" aria-hidden="true"></i>{/if}
        </button>
        <button
          class="flex w-[46px] items-center justify-center text-white hover:bg-[#c42b1c]"
          title="Close"
          aria-label="Close"
          onclick={close}
        >
          {#if windows}<span class="win-glyph" aria-hidden="true">&#xE8BB;</span>{:else}<i class="ph ph-x text-xl" aria-hidden="true"></i>{/if}
        </button>
      </div>
    {/if}
  </div>
</header>

{#if mainMenuOpen && !minimal}
  <AppMenu anchor={mainMenuAnchor} label="Main menu" branded footer={`v${__APP_VERSION__} · ${releaseCodename(__APP_VERSION__)}`}
    onclose={() => mainMenuOpen = false}
    items={[
      { label: 'Settings', icon: 'ph ph-gear-six', action: () => go('settings') },
      { label: 'Your profile', icon: 'ph ph-user', avatar: profile?.avatarUrl, disabled: !profileTarget, action: showProfile },
      { label: 'Quit Cherry', icon: 'ph ph-sign-out', disabled: !isDesktop(), action: close },
    ]} />
{/if}
