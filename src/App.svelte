<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { waitForStartup } from '$lib/app/services/startup';
  import { authIdentity } from '$lib/infra/ytmusic/authContext';
  import { startLyrics } from '$lib/app/services/lyrics';
  import { startRadioRefill } from '$lib/app/services/radio';
  import { startUpdateChecks } from '$lib/app/services/updates';
  import { get } from 'svelte/store';
  import { fade, fly } from '$lib/ui/transitions';
  import { pageStore, startMouseNavigation, go } from '$lib/app/services/navigation';
  import { restoreSettings, settingsStore } from '$lib/app/services/settings';
  import { authStore, initAuth } from '$lib/app/services/auth';
  import { initChannel } from '$lib/app/services/account';
  import { loadHome, loadLibrary, reloadAll } from '$lib/app/services/playlists';
  import { warmup, setDiscordAppId, startPresenceKeepAlive, applyStoredPlaybackSettings, restorePlayback } from '$lib/app/services/player';
  import { startMediaKeyListener } from '$lib/app/services/mediaKeys';
  import { startTray } from '$lib/app/services/tray';
  import { startMemoryTrimming } from '$lib/app/services/memory';
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
  import { washTransition } from '$lib/ui/actions/washTransition';
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

  // Apply the stored theme/accent as early as possible (defaults until settings
  // load, then re-applied) so there is minimal theme flash on launch.
  startAppearance();
  // Mirror the stored UI zoom level onto the webview.
  startZoom();

  // Pages that are useless without a session (everything except Settings, where
  // the sign-in button lives). When signed out these show a full-window gate
  // instead of partial content.
  $: signedOut = ready && !$authStore;

  // Lightweight notice banner. The auth gate publishes `cherry:notice` when it
  // blocks an action (search / play) so the user learns *why* nothing happened
  // instead of the app looking broken.
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function showNotice(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 6000);
  }
  function onNotice(event: Event) {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) showNotice(detail.message);
  }

  // Every page starts at the top (previously a scrolled feed left the next
  // page opened "in the middle"), and the mouse Back/Forward (X1/X2) buttons
  // drive the same history stack.
  onMount(() => {
    const stopLyrics = startLyrics();
    const stopRadio = startRadioRefill();
    const stopUpdates = startUpdateChecks();
    const stopMouse = startMouseNavigation();
    const stopLayout = startLayoutTracking();
    const unsubscribe = pageStore.subscribe(() => {
      if (mainEl) mainEl.scrollTop = 0;
    });
    window.addEventListener('cherry:notice', onNotice);
    // F12 / Ctrl+Shift+I opens the WebView DevTools when the Developer option is
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
    // WebView2 memory trimming is async to set up; hold the cleanup once ready.
    let stopMemory = () => {};
    void startMemoryTrimming().then((stop) => (stopMemory = stop));
    return () => {
      stopLyrics();
      stopRadio();
      stopUpdates();
      stopMouse();
      stopLayout();
      unsubscribe();
      window.removeEventListener('cherry:notice', onNotice);
      window.removeEventListener('keydown', onKeyDown);
      stopShortcuts();
      stopMemory();
    };
  });

  // The app is not a web page: its own right-click menus are the only ones that
  // make sense. Elements that want a menu call `preventDefault` themselves;
  // anything else should not show the browser's ("Save image", "Reload", …).
  function suppressNativeContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  onMount(async () => {
    try {
    await restoreSettings();
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
<div use:washTransition class="cherry-wash relative flex h-full flex-col text-zinc-100" oncontextmenu={suppressNativeContextMenu}>
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
    <!-- Content column: owns the translucent top bar and the floating player.
         `overflow-x-clip` keeps the player bar's drop shadow from spilling left
         over the sidebar, without clipping anything vertically. -->
    <div class="relative flex min-w-0 flex-1 flex-col overflow-x-clip">
      <!-- On the welcome screen only the native window controls remain; the bar
           itself stays draggable. -->
      <Titlebar minimal={signedOut} narrow={$narrowLayout} onMenu={toggleSidebarDrawer} />
      <div class="flex min-h-0 flex-1">
      <div class="relative flex min-w-0 flex-1 flex-col">
      <main
        bind:this={mainEl}
        use:overlayScrollbar={{ topInset: 48 }}
        class="cherry-overlay-scroll cherry-fade-top min-w-0 flex-1 px-6 transition-[padding] duration-300 ease-out {$playerExpanded
          ? 'pt-16 pb-24'
          : 'pt-12 pb-40'}"
      >
        {#if ready}
          <div>
            {#key $pageStore.view}
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
           the playlist rail. It fades in from under the title bar. -->
      {#if notice}
        <div
          class="pointer-events-none absolute inset-x-0 top-14 z-50 flex justify-center px-4"
          role="status"
          aria-live="polite"
          in:fly={{ y: -12, duration: 220 }}
          out:fly={{ y: -12, duration: 160 }}
        >
          <div
            class="flex max-w-lg items-center gap-2 rounded-lg border border-white/10 bg-[var(--color-elevated)]/95 px-4 py-2 text-[12px] text-zinc-200 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur"
          >
            <i class="bx bx-info-circle text-base text-[var(--color-accent2)]"></i>
            <span>{notice}</span>
          </div>
        </div>
      {/if}
      </div>
      {#if ready && !signedOut && $queueSidebarVisible}
        <QueueSidebar />
      {/if}
      </div>
    </div>
  </div>

  <!-- Full-window sign-in gate.
       Covers the entire shell so its top gradient is identical to the app's
       (a gate starting below the titlebar restarts the gradient and shows a seam
       at the top). The titlebar sits above it (`z-40`), staying draggable with
       its window controls; on the welcome screen it renders minimal chrome.
       Settings is the only view allowed through, since that is where sign-in
       lives. -->
  {#if signedOut}
    <div use:washTransition class="cherry-wash cherry-gate absolute inset-0 z-30">
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
      in:fade={{ duration: 150 }}
      out:fade={{ duration: 120 }}
    ></div>
    <div
      class="absolute inset-0 z-30 shadow-[0_0_60px_rgba(0,0,0,0.6)]"
      in:fly={{ x: -280, duration: 220 }}
      out:fly={{ x: -280, duration: 160 }}
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
