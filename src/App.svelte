<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { fade, fly } from 'svelte/transition';
  import { pageStore, startMouseNavigation, go } from '$lib/app/services/navigation';
  import { restoreSettings, settingsStore } from '$lib/app/services/settings';
  import { authStore, initAuth } from '$lib/app/services/auth';
  import { initChannel } from '$lib/app/services/account';
  import { loadHome, loadLibrary, reloadAll } from '$lib/app/services/playlists';
  import { warmup, setDiscordAppId, startPresenceKeepAlive, applyStoredPlaybackSettings, restorePlayback } from '$lib/app/services/player';
  import { startMediaKeyListener } from '$lib/app/services/mediaKeys';
  import { startMemoryTrimming } from '$lib/app/services/memory';
  import { startScrobbling } from '$lib/app/services/scrobble';
  import { openDevTools } from '$lib/app/services/devtools';
  import { startAppearance } from '$lib/app/services/appearance';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import logoUrl from '$lib/assets/logo.png';
  import Titlebar from '$lib/ui/chrome/Titlebar.svelte';
  import Sidebar from '$lib/ui/chrome/Sidebar.svelte';
  import PlayerBar from '$lib/ui/chrome/PlayerBar.svelte';
  import AuthGate from '$lib/ui/components/AuthGate.svelte';
  import ContextMenu from '$lib/ui/components/ContextMenu.svelte';
  import PlaylistPickerDialog from '$lib/ui/components/PlaylistPickerDialog.svelte';
  import EditPlaylistDialog from '$lib/ui/components/EditPlaylistDialog.svelte';
  import HomeView from '$lib/ui/views/HomeView.svelte';
  import ExploreView from '$lib/ui/views/ExploreView.svelte';
  import SearchView from '$lib/ui/views/SearchView.svelte';
  import PlaylistView from '$lib/ui/views/PlaylistView.svelte';
  import ArtistView from '$lib/ui/views/ArtistView.svelte';
  import AlbumView from '$lib/ui/views/AlbumView.svelte';
  import SettingsView from '$lib/ui/views/SettingsView.svelte';

  let ready = false;
  let mainEl: HTMLElement | undefined;

  // Apply the stored theme/accent as early as possible (defaults until settings
  // load, then re-applied) so there is minimal theme flash on launch.
  startAppearance();

  // Pages that are useless without a session (everything except Settings, where
  // the sign-in button lives). When signed out these show a full-window gate
  // instead of partial content.
  $: signedOut = ready && !$authStore;
  $: gatedView = $pageStore.view !== 'settings';

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
    const stopMouse = startMouseNavigation();
    const unsubscribe = pageStore.subscribe(() => {
      if (mainEl) mainEl.scrollTop = 0;
    });
    window.addEventListener('cherry:notice', onNotice);
    // F12 / Ctrl+Shift+I opens the WebView DevTools when the Developer option is
    // enabled (the Settings button is the primary route; this is a convenience).
    const onKeyDown = (event: KeyboardEvent) => {
      if (!get(settingsStore).devToolsEnabled) return;
      const f12 = event.key === 'F12';
      const inspect = event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i';
      if (f12 || inspect) {
        event.preventDefault();
        void openDevTools();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // WebView2 memory trimming is async to set up; hold the cleanup once ready.
    let stopMemory = () => {};
    void startMemoryTrimming().then((stop) => (stopMemory = stop));
    return () => {
      stopMouse();
      unsubscribe();
      window.removeEventListener('cherry:notice', onNotice);
      window.removeEventListener('keydown', onKeyDown);
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
    await restoreSettings();
    // Volume / mute / repeat / shuffle must be applied before the first track.
    applyStoredPlaybackSettings();
    await initAuth();
    warmup();
    await startMediaKeyListener();
    // Apply the stored Discord app id immediately: without this, presence only
    // started working after the save button was pressed in Settings.
    void setDiscordAppId(get(settingsStore).discordAppId);
    startPresenceKeepAlive();
    // Restore the last queue + position (paused, no autoplay) once the session
    // is known — only a signed-in user has a queue worth resuming.
    if (get(authStore)) void restorePlayback();
    startScrobbling();
    ready = true;
    // Channel context first: the home feed and library both depend on it.
    void initChannel().then(() => {
      void loadHome();
      void loadLibrary();
    });
  });

  // Re-run when the stored session changes (sign-in / sign-out).
  let lastCookie = '';
  authStore.subscribe((session) => {
    const cookie = session?.cookie ?? '';
    if (!ready || cookie === lastCookie) return;
    const wasSignedOut = lastCookie === '';
    lastCookie = cookie;
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
<div class="cherry-wash relative flex h-full flex-col text-zinc-100" oncontextmenu={suppressNativeContextMenu}>
  <div class="flex min-h-0 flex-1">
    <!-- Playlist rail: full window height, never covered by the top bar or player.
         Hidden while signed out — there is no library to show, and the welcome
         gate owns the whole page. -->
    {#if ready && !signedOut}
      <Sidebar />
    {/if}
    <!-- Content column: owns the translucent top bar and the floating player. -->
    <div class="relative flex min-w-0 flex-1 flex-col">
      <!-- On the welcome screen only the native window controls remain; the bar
           itself stays draggable. -->
      <Titlebar minimal={signedOut} />
      <main
        bind:this={mainEl}
        use:overlayScrollbar
        class="cherry-overlay-scroll cherry-fade-top min-w-0 flex-1 px-6 pb-28 pt-16"
      >
        {#if !ready}
          <!-- Boot splash: the shell is up, but settings/auth are still being
               restored. Fades out as the real content fades in, so the launch
               never snaps from a blank frame to a full page. -->
          <div
            class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5"
            out:fade={{ duration: 180 }}
          >
            <img src={logoUrl} alt="" class="h-16 w-16 rounded-2xl shadow-[0_18px_50px_rgba(0,0,0,0.6)]" />
            <div class="cherry-eq flex h-4 items-center gap-[3px] text-[var(--color-accent2)]">
              <span></span><span></span><span></span>
            </div>
            <p class="text-[12px] tracking-[0.18em] text-zinc-600 uppercase">Tuning in</p>
          </div>
        {:else}
          <div in:fade={{ duration: 260, delay: 40 }}>
            {#key $pageStore.view}
              <div in:fade={{ duration: 180 }}>
                {#if $pageStore.view === 'home'}
                  <HomeView />
                {:else if $pageStore.view === 'explore'}
                  <ExploreView />
                {:else if $pageStore.view === 'search'}
                  <SearchView />
                {:else if $pageStore.view === 'playlist'}
                  <PlaylistView />
                {:else if $pageStore.view === 'artist'}
                  <ArtistView />
                {:else if $pageStore.view === 'album'}
                  <AlbumView />
                {:else}
                  <SettingsView />
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
  </div>

  <!-- Full-window sign-in gate.
       Covers the entire shell so its top gradient is identical to the app's
       (a gate starting below the titlebar restarts the gradient and shows a seam
       at the top). The titlebar sits above it (`z-40`), staying draggable with
       its window controls; on the welcome screen it renders minimal chrome.
       Settings is the only view allowed through, since that is where sign-in
       lives. -->
  {#if signedOut && gatedView}
    <div class="cherry-wash cherry-gate absolute inset-0 z-30">
      <AuthGate title="Welcome to Cherry :3" />
    </div>
  {/if}

  <!-- Right-click context menu (one instance for the whole app). -->
  <ContextMenu />

  <!-- Playlist add/create and edit dialogs (one instance each). -->
  <PlaylistPickerDialog />
  <EditPlaylistDialog />
</div>
