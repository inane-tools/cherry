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
  import { warmup, setDiscordAppId, startPresenceKeepAlive, applyStoredPlaybackSettings, restorePlayback } from '$lib/app/services/player';
  import { startMediaKeyListener } from '$lib/app/services/mediaKeys';
  import { startTray } from '$lib/app/services/tray';
  import { startScrobbling } from '$lib/app/services/scrobble';
  import { startShortcuts } from '$lib/app/services/shortcuts';
  import { openDevTools } from '$lib/app/services/devtools';
  import { startAppearance } from '$lib/app/services/appearance';
  import { startZoom } from '$lib/app/services/zoom';
  import {
    narrowLayout,
    sidebarDrawerOpen,
    playerExpanded,
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
  import { queueSidebarVisible } from '$lib/app/services/queueSidebar';
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
    || ($pageStore.view === 'browse' && $pageStore.entity.kind === 'profile');

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
<div use:accentWash={{ enabled: !bannerPage }} class="cherry-shell relative isolate flex h-full flex-col text-zinc-100" class:has-page-banner={bannerPage} oncontextmenu={suppressNativeContextMenu}>
  {#if !launched}
    <div class="absolute inset-0 z-[35] bg-[var(--color-surface)]" out:fade={{ duration: 300 }} aria-hidden="true"></div>
  {/if}
  <div class="flex min-h-0 flex-1">
    <!-- Playlist rail: full window height, never covered by the top bar or player.
         Hidden while signed out — there is no library to show, and the welcome
         gate owns the whole page. -->
    {#if ready && !signedOut && !$narrowLayout}
      <Sidebar />
    {/if}
    <!-- Content column owns the translucent top bar and floating player;
         horizontal clipping keeps their effects inside the column. -->
    <div data-page-content class="relative flex min-w-0 flex-1 flex-col overflow-x-clip">
      <div data-page-backdrop-host class="pointer-events-none absolute inset-0 isolate overflow-hidden" aria-hidden="true"></div>
      <!-- On the welcome screen only the native window controls remain; the bar
           itself stays draggable. -->
      <Titlebar minimal={signedOut} scrolled={pageScrolled} narrow={$narrowLayout} {drawerVisible} onMenu={toggleSidebarDrawer} />
      <div class="flex min-h-0 flex-1">
      <div class="relative flex min-w-0 flex-1 flex-col">
      <main
        bind:this={mainEl}
        onscroll={onPageScroll}
        use:overlayScrollbar={{ topInset: 48 }}
        use:pageScroll
        class="cherry-overlay-scroll relative z-0 min-w-0 flex-1 px-6 {$playerExpanded
          ? 'pt-16 pb-24'
          : 'pt-12 pb-40'}"
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
      <PlayerBar />

      <!-- Transient notice. Lives inside the content column (not the window) so
           it is centred over the app content instead of being pulled left by
           the playlist rail. Match the floating compact-player lyrics strip. -->
      {#key notice}
      {#if notice}
        <div
          class="pointer-events-none absolute inset-x-0 top-14 z-50 flex justify-center px-4"
          role="status"
          aria-live="polite"
          transition:fly|global={{ y: -12, duration: 240 }}
        >
          <div
            class="flex w-max max-w-[36rem] items-center gap-3 rounded-xl bg-[var(--color-popover)] px-4 py-3 text-sm font-semibold text-white shadow-lg"
          >
            <i class="ph ph-info shrink-0 text-base text-[var(--color-accent)]" aria-hidden="true"></i>
            <span class="min-w-0 break-words">{notice}</span>
          </div>
        </div>
      {/if}
      {/key}
      </div>
      {#if ready && !signedOut && $queueSidebarVisible}
        <QueueSidebar />
      {/if}
      </div>
    </div>
  </div>

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
      class="absolute inset-0 z-30 bg-scrim/70 backdrop-blur-md"
      role="presentation"
      onclick={closeSidebarDrawer}
      transition:fade={{ duration: 220 }}
    ></div>
    <div
      class="absolute inset-0 z-30 shadow-[0_0_60px_rgba(0,0,0,0.6)]"
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
</div>
