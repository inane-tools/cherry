<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { waitForStartup } from '$lib/app/services/startup';
  import { authIdentity } from '$lib/infra/ytmusic/authContext';
  import { startLyrics } from '$lib/app/services/lyrics';
  import { startRadioRefill } from '$lib/app/services/radio';
  import { startUpdateChecks } from '$lib/app/services/updates';
  import { derived, get } from 'svelte/store';
  import { fade, fly } from '$lib/ui/transitions';
  import { pageStore, pageKey, startMouseNavigation, go } from '$lib/app/services/navigation';
  import { restoreSettings, settingsStore } from '$lib/app/services/settings';
  import { authStore, initAuth } from '$lib/app/services/auth';
  import { activeChannelStore, initChannel } from '$lib/app/services/account';
  import { clearPageVisitCache } from '$lib/app/services/pageVisit';
  import { homeSectionsStore, loadHome, loadLibrary, reloadAll } from '$lib/app/services/playlists';
  import { warmProfileGreetings } from '$lib/app/services/profilePersonalization';
  import { warmup, setDiscordAppId, startPresenceKeepAlive, applyStoredPlaybackSettings, restorePlayback, playerStore, videoMode, videoSurface } from '$lib/app/services/player';
  import Visualizer from '$lib/ui/components/Visualizer.svelte';
  import { startMediaKeyListener } from '$lib/app/services/mediaKeys';
  import { startTray } from '$lib/app/services/tray';
  import { startScrobbling } from '$lib/app/services/scrobble';
  import { startShortcuts } from '$lib/app/services/shortcuts';
  import { openDevTools } from '$lib/app/services/devtools';
  import { startAppearance } from '$lib/app/services/appearance';
  import { isMacDesktop, isLinuxDesktop } from '$lib/app/services/platform';
  import { nativeTitlebar, trackNativeTitlebar } from '$lib/app/services/nativeTitlebar';
  import { renderedZoom, startZoom } from '$lib/app/services/zoom';
  import {
    narrowLayout,
    sidebarDrawerOpen,
    playerExpanded,
    compactPlayerHeight,
    startLayoutTracking,
    toggleSidebarDrawer,
    closeSidebarDrawer,
  } from '$lib/app/services/layout';
  import { initFolders } from '$lib/app/services/folders';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { pageScroll } from '$lib/ui/actions/pageScroll';
  import { accentWash } from '$lib/ui/actions/accentWash';
  import Titlebar from '$lib/ui/chrome/Titlebar.svelte';
  import Sidebar from '$lib/ui/chrome/Sidebar.svelte';
  import PlayerBar from '$lib/ui/chrome/PlayerBar.svelte';
  import QueueSidebar from '$lib/ui/chrome/QueueSidebar.svelte';
  import { queueSidebarVisible, QUEUE_SIDEBAR_WIDTH } from '$lib/app/services/queueSidebar';
  import AuthGate from '$lib/ui/components/AuthGate.svelte';
  import ContextMenu from '$lib/ui/components/ContextMenu.svelte';
  import PlaylistPickerDialog from '$lib/ui/components/PlaylistPickerDialog.svelte';
  import EditPlaylistDialog from '$lib/ui/components/EditPlaylistDialog.svelte';
  import DeletePlaylistDialog from '$lib/ui/components/DeletePlaylistDialog.svelte';
  import FolderDialog from '$lib/ui/components/FolderDialog.svelte';
  import SongCreditsDialog from '$lib/ui/components/SongCreditsDialog.svelte';
  import SettingsOverlay from '$lib/ui/components/SettingsOverlay.svelte';
  import SearchOverlay from '$lib/ui/components/SearchOverlay.svelte';
  import HomeView from '$lib/ui/views/HomeView.svelte';
  import PlaylistView from '$lib/ui/views/PlaylistView.svelte';
  import ArtistView from '$lib/ui/views/ArtistView.svelte';
  import AlbumView from '$lib/ui/views/AlbumView.svelte';
  import MixView from '$lib/ui/views/MixView.svelte';
  import BrowseView from '$lib/ui/views/BrowseView.svelte';

  let ready = false;
  let launched = false;
  let stopTray = () => {};
  let destroyed = false;
  onDestroy(() => { destroyed = true; stopTray(); });
  let mainEl: HTMLElement | undefined;
  let pageScrolled = false;
  let drawerVisible = false;
  $: if ($sidebarDrawerOpen) drawerVisible = true;

  function drawerSlide(node: Element) {
    return fly(node, { x: -node.getBoundingClientRect().width, opacity: 1, duration: 220 });
  }

  function onPageScroll(event: Event): void {
    const scrolled = (event.currentTarget as HTMLElement).scrollTop > 0;
    if (pageScrolled !== scrolled) pageScrolled = scrolled;
  }


  // Mirror the stored UI zoom level onto the renderer.
  startZoom();

  // Pages that are useless without a session (everything except Settings, where
  // the sign-in button lives). When signed out these show a full-window gate
  // instead of partial content.
  $: signedOut = ready && !$authStore;

  $: bannerPage = ['playlist', 'album', 'artist'].includes($pageStore.view)
    || ($pageStore.view === 'browse' && ['profile', 'mix'].includes($pageStore.entity.kind ?? ''));

  // Lightweight notice banner. The auth gate publishes `cherry:notice` when it
  // blocks an action (search / play) so the user learns *why* nothing happened
  // instead of the app looking broken.
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  onDestroy(() => { if (noticeTimer) clearTimeout(noticeTimer); });
  function showNotice(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 6000);
  }
  function onNotice(event: Event) {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) showNotice(detail.message);
  }

  // Fresh pages start at the top; Back/Forward restores feed positions.
  onMount(() => {
    const stopTitlebar = trackNativeTitlebar();
    const stopLyrics = startLyrics();
    const stopRadio = startRadioRefill();
    const stopUpdates = startUpdateChecks();
    const stopMouse = startMouseNavigation();
    const stopLayout = startLayoutTracking();
    const stopVisitContext = derived([authStore, activeChannelStore], ([session, profile]) =>
      `${authIdentity(session)}:${profile?.pageId ?? ''}`).subscribe(clearPageVisitCache);
    window.addEventListener('cherry:notice', onNotice);
    // F12 / Ctrl+Shift+I opens the renderer DevTools when the Developer option is
    // enabled (the Settings button is the primary route; this is a convenience).
    const onKeyDown = (event: KeyboardEvent) => {
      const settings = get(settingsStore);
      if (!settings.developerUnlocked || !settings.devToolsEnabled) return;
      const f12 = event.key === 'F12';
      const inspect = event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i';
      if (f12 || inspect) {
        event.preventDefault();
        void openDevTools();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // Player / navigation shortcuts (Space, arrows, Ctrl+F, …).
    const stopShortcuts = startShortcuts();
    return () => {
      stopTitlebar();
      stopLyrics();
      stopRadio();
      stopUpdates();
      stopMouse();
      stopLayout();
      stopVisitContext();
      window.removeEventListener('cherry:notice', onNotice);
      window.removeEventListener('keydown', onKeyDown);
      stopShortcuts();
    };
  });

  // Let Electron provide text editing menus; app surfaces own their menus.
  function suppressNativeContextMenu(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
  }

  // Warm optional greeting data after Home arrives, outside the startup budget.
  onMount(() => homeSectionsStore.subscribe(sections => {
    if (sections.length) void warmProfileGreetings(sections);
  }));

  onMount(async () => {
    try {
    await restoreSettings();
    // Keep the startup snapshot until real settings arrive, rather than briefly
    // applying defaults over it.
    startAppearance();
    initFolders();
    // Volume / mute / repeat / shuffle must be applied before the first track.
    applyStoredPlaybackSettings();
    // Media-key listeners are independent of the session; register them in the
    // background so startup is not serialised behind several IPC round trips.
    void startMediaKeyListener();
    await initAuth();
    void startTray().then((stop) => { if (destroyed) stop(); else stopTray = stop; });
    warmup();
    // Apply the stored Discord app id immediately: without this, presence only
    // started working after the save button was pressed in Settings.
    void setDiscordAppId(get(settingsStore).discordAppId);
    startPresenceKeepAlive();
    startScrobbling();
    ready = true;
    // Mount the real shell behind a quiet themed cover. Resolve the channel
    // before restoring video as well as before requesting the feed/library.
    if (get(authStore)) {
      await waitForStartup(initChannel().then(() => Promise.allSettled([
        loadHome(), loadLibrary(), restorePlayback(),
      ])), 2000);
      await tick();
      // Give the first covers a brief decode budget, without waiting forever
      // for a slow connection or unavailable image.
      const images = Array.from(mainEl?.querySelectorAll('img') ?? []).slice(0, 12);
      await waitForStartup(Promise.allSettled(images.map(image => image.decode())), 350);
    }
    } catch (error) {
      console.error('[cherry] Startup restoration failed:', error);
    } finally {
      if (!destroyed) {
        ready = true;
        launched = true;
        requestAnimationFrame(() => {
          if (!destroyed) document.documentElement.classList.add('theme-ready');
        });
      }
    }
  });

  // Re-run when the stored session changes (sign-in / sign-out).
  let lastCookie = '';
  authStore.subscribe((session) => {
    const cookie = authIdentity(session);
    if (cookie === lastCookie) return;
    const wasSignedOut = lastCookie === '';
    lastCookie = cookie;
    // Track the restored session during startup too, so the first sign-out
    // after launch is recognized as a session change.
    if (!ready) return;
    if (cookie) {
      // Sign-in: force a genuine refetch, so a login after clearing the cache
      // reliably repopulates the rail and home feed. Then resume the queue.
      void reloadAll().then(() => restorePlayback());
    } else if (!wasSignedOut) {
      // Sign-out: drop the previous account's data and return to the welcome
      // screen (the gate covers everything but Settings).
      void initChannel(true).then(() => {
        void loadHome();
        void loadLibrary();
      });
      go('home');
    }
  });

</script>

<!-- svelte-ignore a11y_no_static_element_interactions : only prevents the native menu -->
<div data-page-content use:accentWash={{ enabled: !bannerPage }} class="cherry-shell relative isolate flex h-full flex-col text-zinc-100" class:has-page-banner={bannerPage} class:macos={isMacDesktop()} class:native-chrome={isMacDesktop() || isLinuxDesktop()}
  data-sidebar-layout={ready && !signedOut && !$narrowLayout ? ($settingsStore.compactSidebar ? 'compact' : 'expanded') : 'none'}
  style:--cherry-ui-scale={$renderedZoom}
  style:--native-controls-left={`${$nativeTitlebar.left}px`}
  style:--native-controls-right={`${$nativeTitlebar.right}px`}
  style:--cherry-player-clearance={`${$compactPlayerHeight + 16}px`}
  oncontextmenu={suppressNativeContextMenu}>
  {#if !launched}
    <div class="absolute inset-0 z-[35] bg-[var(--color-surface)]" out:fade={{ duration: 300 }} aria-hidden="true"></div>
  {/if}
  {#if ready && !signedOut && $settingsStore.videoBackground && $videoMode && !$playerExpanded}
    <!-- Experimental: the music video plays behind the window while the player
         is collapsed; expanding the player moves it back into the player. -->
    <div use:videoSurface class="cherry-video-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true"></div>
  {/if}
  {#if ready && !signedOut && $settingsStore.visualizerEnabled && !$videoMode}
    <!-- Experimental music visualizer, behind everything in the window. -->
    <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <Visualizer active={$playerStore.status === 'playing'} />
    </div>
  {/if}
  <div data-page-backdrop-host class="pointer-events-none absolute inset-0 -z-10 isolate overflow-hidden" aria-hidden="true"></div>
  <Titlebar minimal={signedOut} scrolled={pageScrolled} narrow={$narrowLayout} {drawerVisible} onMenu={toggleSidebarDrawer} />
  <div class="flex min-h-0 flex-1">
    <!-- Both rails float between the full-window title bar and player. -->
    {#if ready && !signedOut && !$narrowLayout}
      <Sidebar />
    {/if}
    <div class="relative flex min-w-0 flex-1 flex-col overflow-x-clip" style:margin-left="calc(-1 * var(--cherry-sidebar-inset, 0px))">
      <div class="flex min-h-0 flex-1">
      <div class="relative flex min-w-0 flex-1 flex-col">
      <main
        style:--cherry-queue-inset={`${ready && !signedOut && $queueSidebarVisible ? QUEUE_SIDEBAR_WIDTH : 0}px`}
        style:padding-right="calc(24px + var(--cherry-queue-inset))"
        style:padding-left="calc(24px + var(--cherry-sidebar-inset, 0px))"
        style:padding-bottom={$playerExpanded ? '6rem' : 'calc(var(--cherry-player-clearance, 104px) + 24px)'}
        bind:this={mainEl}
        onscroll={onPageScroll}
        use:overlayScrollbar={{ topInset: 48, rightInset: ready && !signedOut && $queueSidebarVisible ? QUEUE_SIDEBAR_WIDTH : 0 }}
        use:pageScroll
        class="cherry-overlay-scroll relative z-0 min-w-0 flex-1 px-6 {$playerExpanded
          ? 'pt-16'
          : 'pt-12'}"
      >
        {#if ready}
          <div>
            {#key `${$pageStore.view}:${pageKey($pageStore)}`}
              <div in:fade={{ duration: launched ? 180 : 0 }}>
                {#if $pageStore.view === 'playlist'}
                  <PlaylistView />
                {:else if $pageStore.view === 'artist'}
                  <ArtistView />
                {:else if $pageStore.view === 'album'}
                  <AlbumView />
                {:else if $pageStore.view === 'browse' && $pageStore.entity.kind === 'mix'}
                  <MixView />
                {:else if $pageStore.view === 'browse' || $pageStore.view === 'explore'}
                  <BrowseView />
                {:else}
                  <HomeView />
                {/if}
              </div>
            {/key}
          </div>
        {/if}
      </main>


      </div>
      {#if ready && !signedOut && $queueSidebarVisible}
        <QueueSidebar />
      {/if}
      </div>
    </div>
  </div>

  <PlayerBar />

  <!-- Full-window sign-in gate.
       Covers the entire shell with a solid theme surface, including behind
       the titlebar. The titlebar sits above it (`z-40`), staying draggable with
       its window controls; on the welcome screen it renders minimal chrome.
       Settings is the only view allowed through, since that is where sign-in
       lives. -->
  {#if signedOut}
    <div class="cherry-gate absolute inset-0 z-30">
      <AuthGate title="Welcome to Cherry :3" />
    </div>
  {/if}

  <!-- Narrow-mode sidebar drawer (the inline rail is hidden at this width). -->
  {#if ready && !signedOut && $narrowLayout && $sidebarDrawerOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="absolute inset-0 z-[25] bg-scrim/70 backdrop-blur-md"
      role="presentation"
      onclick={closeSidebarDrawer}
      transition:fade={{ duration: 220 }}
    ></div>
    <div
      class="absolute inset-0 z-[25] shadow-[0_0_60px_rgba(0,0,0,0.6)]"
      transition:drawerSlide
      onoutroend={() => { if (!get(sidebarDrawerOpen)) drawerVisible = false; }}
    >
      <Sidebar forceFull />
    </div>
  {/if}

  <!-- Right-click context menu (one instance for the whole app). -->
  <ContextMenu />

  <!-- Playlist add/create and edit dialogs (one instance each). -->
  <PlaylistPickerDialog />
  <EditPlaylistDialog />
<DeletePlaylistDialog />
  <FolderDialog />
  <SongCreditsDialog />

  <!-- Floating Settings / Search panels (above the sign-in gate). -->
  <SettingsOverlay />
  <SearchOverlay />
  <!-- Notices must stay above dialog backdrops, including upload errors. -->
  {#key notice}
  {#if notice}
    <div
      class="pointer-events-none absolute inset-x-0 top-14 z-[90] flex justify-center px-4"
      role="status"
      aria-live="polite"
      transition:fly|global={{ y: -12, duration: 240 }}
    >
      <div
        class="flex w-max max-w-[36rem] items-center gap-3 rounded-xl cherry-glass px-4 py-3 text-sm font-semibold text-white shadow-lg"
      >
        <i class="ph ph-info shrink-0 text-base text-[var(--color-accent)]" aria-hidden="true"></i>
        <span class="min-w-0 break-words">{notice}</span>
      </div>
    </div>
  {/if}
  {/key}
</div>
