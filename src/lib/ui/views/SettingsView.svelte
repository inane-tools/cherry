<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    authStore,
    beginYtmLogin,
    cancelYtmLogin,
    finishYtmLogin,
    pollYtmStatus,
    signInWithCookie,
    signOut,
  } from '$lib/app/services/auth';
  import { libraryLoading, playlistStore, refreshLibrary, reloadAll } from '$lib/app/services/playlists';
  import {
    activeChannelStore,
    channelsStore,
    refreshActiveProfile,
    selectChannel,
  } from '$lib/app/services/account';
  import { settingsStore, updateSettings } from '$lib/app/services/settings';
  import { setDefaultPlaylist } from '$lib/app/services/playlistEdit';
  import { addablePlaylistsStore, loadAddablePlaylists } from '$lib/app/services/addablePlaylists';
  import { beginAuth, completeAuth } from '$lib/app/services/lastfm';
  import { openDevTools, reloadFrontend } from '$lib/app/services/devtools';
  import { refreshDiscord } from '$lib/app/services/player';
  import { clearAllData, clearCache, formatCacheSize } from '$lib/app/services/maintenance';
  import { DISCLAIMER } from '$lib/app/services/gate';
  import { isTauri } from '$lib/app/services/platform';
  import {
    applyZoom,
    ZOOM_MAX,
    ZOOM_MIN,
    ZOOM_STEP,
    ZOOM_STEPS,
    zoomFillPercent,
  } from '$lib/app/services/zoom';
  import SettingsSection from '$lib/ui/components/SettingsSection.svelte';
  import Toggle from '$lib/ui/components/Toggle.svelte';
  // Bundled (hashed) rather than `/logo.png`: an absolute public path is served
  // by the asset protocol, which can 404 in the window right after the cache is
  // cleared. A build-time import always resolves to a real, versioned URL.
  import logoUrl from '$lib/assets/logo.png';
  import inaneWordmark from '$lib/assets/inane.svg';

  // ── Clear data and cache ────────────────────────────────────────
  let cacheLabel = 'calculating…';
  let clearing = false;
  let clearingCache = false;
  let clearNotice = '';

  async function refreshCacheLabel() {
    cacheLabel = await formatCacheSize();
  }
  refreshCacheLabel();
  // The default-playlist list must only contain writable playlists.
  void loadAddablePlaylists();

  async function clearData() {
    if (clearing || clearingCache) return;
    clearing = true;
    clearNotice = '';
    try {
      const { removed, locked } = await clearAllData();
      // The session is cleared by the same action, so reflect that in the UI.
      await signOut();
      message = '';
      const parts: string[] = [];
      if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`);
      if (locked.length > 0) parts.push(`${locked.join(', ')} is locked until Cherry restarts`);
      // Nothing on disk and nothing locked means there was nothing to do — a
      // second press must be a quiet no-op, not an error or a pointless restart.
      if (parts.length === 0) {
        clearNotice = 'Nothing left to clear.';
        return;
      }
      clearNotice = `Cleared — ${parts.join('; ')}. Restarting…`;
      // Restart so the wipe is actually observable: while the app is running it
      // re-persists settings (channel context, volume…) on the next write, which
      // would make a cleared settings file reappear. A relaunch starts clean.
      // Its failure must never look like the *clear* failed, so it is caught
      // separately.
      if (isTauri()) {
        try {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } catch {
          clearNotice = `Cleared — ${parts.join('; ')}. Restart Cherry to finish.`;
        }
        return;
      }
      await refreshCacheLabel();
    } catch (e) {
      clearNotice = e instanceof Error ? e.message : String(e);
    } finally {
      clearing = false;
    }
  }

  async function clearCacheOnly() {
    if (clearing || clearingCache) return;
    clearingCache = true;
    clearNotice = '';
    try {
      await clearCache();
      clearNotice = 'Cache cleared.';
      await refreshCacheLabel();
    } catch (e) {
      clearNotice = e instanceof Error ? e.message : String(e);
    } finally {
      clearingCache = false;
    }
  }

  type LoginPhase = 'idle' | 'starting' | 'waiting';
  let phase: LoginPhase = 'idle';
  let popupStatus = '';
  let message = '';
  let error = '';
  let polling = false;
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  // Manual fallback
  let showPaste = false;
  let cookie = '';
  let label = '';
  let busy = false;

  // Last.fm
  let lastfmKey = get(settingsStore).lastfmApiKey;
  let lastfmSecret = get(settingsStore).lastfmApiSecret;
  let lastfmToken: string | null = null;
  let lastfmBusy = false;
  let lastfmError = '';
  let lastfmMessage = '';

  // UI zoom is applied live while dragging but only persisted on release, so the
  // slider handle never fights the asynchronous settings write.
  let zoomDraft: number | null = null;
  $: zoomValue = zoomDraft ?? ($settingsStore.uiZoom ?? 1);

  const THEME_OPTIONS: { value: 'system' | 'light' | 'dark'; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'bx bx-desktop' },
    { value: 'light', label: 'Light', icon: 'bx bx-sun' },
    { value: 'dark', label: 'Dark', icon: 'bx bx-moon' },
  ];
  const ACCENT_SOURCE_OPTIONS: { value: 'song' | 'custom'; label: string; icon: string }[] = [
    { value: 'song', label: 'Song Art', icon: 'bx bx-album' },
    { value: 'custom', label: 'Custom', icon: 'bx bx-color-fill' },
  ];
  const ACCENT_PRESETS = ['#ff4d5e', '#ff8a5c', '#8b5cf6', '#22c55e', '#0ea5e9', '#f5a524'];

  async function setDefaultPlaylistById(id: string): Promise<void> {
    const playlist = get(addablePlaylistsStore).find((p) => p.browseId === id) ?? null;
    await setDefaultPlaylist(playlist);
  }

  async function connectLastfm(): Promise<void> {
    lastfmError = '';
    lastfmMessage = '';
    lastfmBusy = true;
    try {
      await updateSettings({ lastfmApiKey: lastfmKey.trim(), lastfmApiSecret: lastfmSecret.trim() });
      lastfmToken = await beginAuth(lastfmKey.trim(), lastfmSecret.trim());
      lastfmMessage = 'Approve access in the browser, then click “I’ve authorized”.';
    } catch (e) {
      lastfmError = e instanceof Error ? e.message : String(e);
    } finally {
      lastfmBusy = false;
    }
  }

  async function finishLastfm(): Promise<void> {
    if (!lastfmToken) return;
    lastfmError = '';
    lastfmBusy = true;
    try {
      const { sessionKey, username } = await completeAuth(
        lastfmKey.trim(),
        lastfmSecret.trim(),
        lastfmToken,
      );
      await updateSettings({
        lastfmApiKey: lastfmKey.trim(),
        lastfmApiSecret: lastfmSecret.trim(),
        lastfmSessionKey: sessionKey,
        lastfmUsername: username,
        lastfmEnabled: true,
      });
      lastfmToken = null;
      lastfmMessage = `Connected as ${username}.`;
    } catch (e) {
      lastfmError = e instanceof Error ? e.message : String(e);
    } finally {
      lastfmBusy = false;
    }
  }

  async function disconnectLastfm(): Promise<void> {
    await updateSettings({ lastfmSessionKey: '', lastfmUsername: '', lastfmEnabled: false });
    lastfmToken = null;
    lastfmMessage = 'Disconnected from Last.fm.';
    lastfmError = '';
  }

  $: profile = $activeChannelStore;
  $: name = profile?.name || $authStore?.accountLabel || 'No session';
  $: initial = name.charAt(0).toUpperCase() || 'Y';

  async function chooseChannel(pageId: string) {
    await selectChannel(pageId);
    await reloadAll();
  }

  function stopPolling() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
  }

  async function checkLogin() {
    // Never overlap polls: reading native cookies while another read (or the
    // window teardown) is in flight is what tripped the wry panic.
    if (polling) return;
    polling = true;
    try {
      const status = await pollYtmStatus();
      if (!status.open) {
        // The user closed the window. Stop polling instead of hammering the
        // native cookie store for a webview that is gone.
        stopPolling();
        if (phase === 'waiting') {
          phase = 'idle';
          popupStatus = 'Login window closed';
        }
        return;
      }
      popupStatus = status.loggedIn ? 'Account detected — finishing…' : `Waiting for sign-in…`;
    if (status.loggedIn) {
      stopPolling();
      try {
        await finishYtmLogin();
        // Resolve the channel context and the profile straight away, instead
        // of leaving the top bar/account blank until a later reload.
        await reloadAll();
        await refreshActiveProfile();
        message = `Signed in — ${get(playlistStore).length} playlists loaded.`;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        phase = 'idle';
      }
    }
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    stopPolling();
    statusTimer = setInterval(() => void checkLogin(), 2500);
    void checkLogin();
  }

  async function loginWithYouTube() {
    phase = 'starting';
    message = '';
    error = '';
    try {
      await beginYtmLogin();
      phase = 'waiting';
      startPolling();
    } catch (e) {
      phase = 'idle';
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function cancelLogin() {
    stopPolling();
    cancelYtmLogin();
    phase = 'idle';
    popupStatus = '';
  }

  async function disconnect() {
    stopPolling();
    await signOut();
    message = 'Signed out.';
  }

  async function refreshPlaylists() {
    message = '';
    error = '';
    try {
      await refreshLibrary();
      await refreshActiveProfile();
      message = `Playlists refreshed — ${get(playlistStore).length} loaded.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function pasteLogin(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    message = '';
    error = '';
    try {
      await signInWithCookie(cookie, label);
      await reloadAll();
      await refreshActiveProfile();
      cookie = '';
      message = `Token saved — ${get(playlistStore).length} playlists loaded.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function setDiscordEnabled(value: boolean) {
    await updateSettings({ discordEnabled: value });
    await refreshDiscord();
  }

  async function setStatusDisplay(value: string) {
    const mode = value === 'state' || value === 'name' ? value : 'details';
    await updateSettings({ discordStatusDisplay: mode });
    await refreshDiscord();
  }

  async function openExternal(url: string) {
    if (!isTauri()) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  }

  async function openInaneTools() {
    await openExternal('https://inane.tools');
  }

  onDestroy(stopPolling);
</script>

<div class="mx-auto max-w-3xl pb-6">
  <header class="mb-6">
    <h1 class="text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">Settings</h1>
    <p class="mt-1 text-[12px] text-zinc-500">Account, integrations and app data.</p>
  </header>

  <div class="flex flex-col gap-3">
    <!-- Account & Integrations -->
    <h2 class="mt-6 text-[18px] font-extrabold tracking-tight text-white first:mt-0 sm:text-[20px]">
      Account &amp; Integrations
    </h2>
    <!-- Account -->
    <SettingsSection title={name} description={`${profile?.handle ? `${profile.handle} · ` : ''}${$playlistStore.length} playlists`}>
      <span slot="leading" class="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[var(--color-avatar)]">
        {#if profile?.avatarUrl}
          <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-sm font-bold text-[#181818]">{initial}</span>
        {/if}
      </span>

      <span slot="action">
        {#if $authStore}
          <div class="flex items-center gap-2">
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
              disabled={$libraryLoading}
              onclick={refreshPlaylists}
              title="Refresh playlists"
              aria-label="Refresh playlists"
            >
              <i class="bx bx-refresh text-sm" class:bx-spin={$libraryLoading}></i>
            </button>
            <button
              class="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              onclick={disconnect}
            >
              <i class="bx bx-log-out text-sm"></i>
              Sign out
            </button>
          </div>
        {/if}
      </span>

      {#if !$authStore && phase !== 'waiting'}
        <button
          class="cherry-btn-scrim flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--color-accent2)] disabled:opacity-40"
          disabled={phase === 'starting' || !isTauri()}
          onclick={loginWithYouTube}
        >
          <i class="bx bxl-youtube text-base"></i>
          {phase === 'starting' ? 'Opening…' : 'Sign in with YouTube Music'}
        </button>
        {#if !isTauri()}
          <p class="mt-2 text-[10px] text-zinc-600">In-app sign-in needs the desktop app.</p>
        {/if}
      {/if}

      {#if phase === 'waiting'}
        <div class="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-accent)]/20 bg-black/20 px-3 py-2.5 text-[11px] text-zinc-300">
          <span class="flex min-w-0 items-center gap-2">
            <i class="bx bx-loader-alt bx-spin shrink-0"></i>
            <span class="truncate">{popupStatus || 'Sign in to YouTube Music in the opened window.'}</span>
          </span>
          <button class="shrink-0 text-zinc-400 transition-colors hover:text-white" onclick={cancelLogin}>Cancel</button>
        </div>
      {/if}

      {#if !$authStore}
        <button
          class="mt-3 flex items-center gap-1 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
          onclick={() => (showPaste = !showPaste)}
        >
          <i class={showPaste ? 'bx bx-chevron-up' : 'bx bx-chevron-down'}></i>
          Paste a session token instead
        </button>
        {#if showPaste}
          <form class="mt-2 flex flex-col gap-2 sm:flex-row" onsubmit={pasteLogin}>
            <input
              bind:value={label}
              placeholder="Label (optional)"
              class="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60 sm:w-28"
            />
            <input
              bind:value={cookie}
              type="password"
              placeholder="paste Cookie header…"
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60"
            />
            <button
              disabled={busy || !cookie.trim()}
              class="cherry-btn-scrim rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent2)] disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        {/if}
      {/if}

      {#if $authStore && $channelsStore.length > 1}
        <div class="mt-4 border-t border-white/[0.06] pt-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="text-[12px] font-semibold text-zinc-200">Channel</span>
            <span class="text-[10px] text-zinc-600">each has its own library</span>
          </div>
          <div class="flex flex-col gap-0.5">
            {#each $channelsStore.filter((c) => c.isChannel) as channel}
              <button
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors {$activeChannelStore?.pageId ===
                channel.pageId
                  ? 'bg-[var(--color-accent)]/15 text-white'
                  : 'text-zinc-400 hover:bg-white/5'}"
                onclick={() => chooseChannel(channel.pageId ?? '')}
              >
                <span class="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-[var(--color-avatar)]">
                  {#if channel.avatarUrl}
                    <img src={channel.avatarUrl} alt="" class="h-full w-full object-cover" />
                  {:else}
                    <span class="flex h-full w-full items-center justify-center text-[9px] text-[var(--color-accent2)]">{channel.name.charAt(0).toUpperCase()}</span>
                  {/if}
                </span>
                <span class="min-w-0 flex-1 truncate">{channel.name}</span>
                {#if $activeChannelStore?.pageId === channel.pageId}
                  <i class="bx bx-check text-sm text-[var(--color-accent2)]"></i>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if $authStore}
        <div class="mt-4 border-t border-white/[0.06] pt-3">
          <div class="flex items-center justify-between gap-4">
            <span class="text-[12px] text-zinc-300">Default save playlist</span>
            <select
              value={$settingsStore.defaultPlaylistBrowseId}
              onchange={(e) => setDefaultPlaylistById((e.currentTarget as HTMLSelectElement).value)}
              class="max-w-[55%] rounded-lg border border-white/10 bg-[var(--color-field)] px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors focus:border-[var(--color-accent)]/60"
            >
              <option value="">Always ask</option>
              {#if $settingsStore.defaultPlaylistBrowseId && !$addablePlaylistsStore.some((p) => p.browseId === $settingsStore.defaultPlaylistBrowseId)}
                <option value={$settingsStore.defaultPlaylistBrowseId}>
                  {$settingsStore.defaultPlaylistTitle || 'Saved default'}
                </option>
              {/if}
              {#each $addablePlaylistsStore as playlist (playlist.browseId)}
                <option value={playlist.browseId}>{playlist.title}</option>
              {/each}
            </select>
          </div>
          <p class="mt-2 text-[10px] leading-relaxed text-zinc-600">
            Where “Add to playlist” saves a song. Only playlists you can edit are listed.
          </p>
        </div>
      {/if}

      {#if message}
        <p class="mt-3 flex items-start gap-1.5 text-[11px] text-emerald-300">
          <i class="bx bx-check-circle mt-0.5 shrink-0"></i>{message}
        </p>
      {/if}
      {#if error}
        <p class="mt-3 flex items-start gap-1.5 text-[11px] text-rose-300">
          <i class="bx bx-error-circle mt-0.5 shrink-0"></i>{error}
        </p>
      {/if}
    </SettingsSection>

    <!-- Integrations -->
    <SettingsSection
      title="Integrations"
      description="Connect Cherry to the services you use."
      icon="bx bx-plug"
    >
      <div class="flex flex-col">
        <!-- Discord -->
        <div class="pb-5">
          <div class="flex items-center justify-between gap-4">
            <span class="flex items-center gap-2 text-[12px] font-semibold text-zinc-200">
              <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-zinc-400" fill="currentColor" aria-hidden="true">
                <path
                  d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"
                />
              </svg>
              Discord
            </span>
            <Toggle
              checked={$settingsStore.discordEnabled}
              label="Discord"
              onchange={setDiscordEnabled}
            />
          </div>
          <label class="mt-3 flex items-center justify-between gap-4">
            <span class="text-[12px] text-zinc-300">Show next to your name</span>
            <select
              value={$settingsStore.discordStatusDisplay}
              onchange={(e) => setStatusDisplay((e.currentTarget as HTMLSelectElement).value)}
              class="rounded-lg border border-white/10 bg-[var(--color-field)] px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors focus:border-[var(--color-accent)]/60"
            >
              <option value="details">Song title</option>
              <option value="state">Artist</option>
              <option value="name">App name</option>
            </select>
          </label>
        </div>

        <!-- Last.fm -->
        <div class="border-t border-white/[0.06] pt-5">
          <div class="flex items-center justify-between gap-4">
            <span class="flex items-center gap-2 text-[12px] font-semibold text-zinc-200">
              <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-zinc-400" fill="currentColor" aria-hidden="true">
                <path
                  d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"
                />
              </svg>
              Last.fm
            </span>
            {#if $settingsStore.lastfmSessionKey}
              <Toggle
                checked={$settingsStore.lastfmEnabled}
                label="Scrobble to Last.fm"
                onchange={(value) => updateSettings({ lastfmEnabled: value })}
              />
            {/if}
          </div>
          {#if $settingsStore.lastfmSessionKey}
            <div class="mt-3 flex items-center justify-between gap-4">
              <span class="text-[12px] text-zinc-300">
                Connected as
                <span class="font-semibold text-[var(--color-accent2)]"
                  >{$settingsStore.lastfmUsername || 'Last.fm user'}</span
                >
              </span>
              <button
                class="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                onclick={disconnectLastfm}
              >
                Disconnect
              </button>
            </div>

            <div class="mt-4 flex flex-col gap-3 border-t border-white/[0.06] pt-4">
              <label class="flex items-center justify-between gap-4">
                <span class="text-[12px] text-zinc-300">Send “now playing”</span>
                <Toggle
                  checked={$settingsStore.lastfmNowPlaying}
                  label="Send now playing"
                  onchange={(value) => updateSettings({ lastfmNowPlaying: value })}
                />
              </label>
              <label class="flex items-center justify-between gap-4">
                <span class="text-[12px] text-zinc-300">Scrobble after</span>
                <select
                  value={String($settingsStore.lastfmScrobblePercent ?? 50)}
                  onchange={(e) =>
                    updateSettings({
                      lastfmScrobblePercent: Number((e.currentTarget as HTMLSelectElement).value),
                    })}
                  class="rounded-lg border border-white/10 bg-[var(--color-field)] px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors focus:border-[var(--color-accent)]/60"
                >
                  <option value="50">50% — recommended</option>
                  <option value="75">75%</option>
                  <option value="90">90%</option>
                </select>
              </label>
              <label class="flex items-center justify-between gap-4">
                <span class="text-[12px] text-zinc-300">Skip tracks under</span>
                <select
                  value={String($settingsStore.lastfmMinDurationSeconds ?? 30)}
                  onchange={(e) =>
                    updateSettings({
                      lastfmMinDurationSeconds: Number(
                        (e.currentTarget as HTMLSelectElement).value,
                      ),
                    })}
                  class="rounded-lg border border-white/10 bg-[var(--color-field)] px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors focus:border-[var(--color-accent)]/60"
                >
                  <option value="0">No minimum</option>
                  <option value="30">30 seconds</option>
                  <option value="45">45 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </label>
            </div>
          {:else}
            <p class="mt-3 text-[11px] leading-relaxed text-zinc-400">
              Scrobbling uses <span class="text-zinc-200">your own</span> Last.fm API key. Create one at
              <button
                class="text-[var(--color-accent2)] underline decoration-[var(--color-accent2)]/30 underline-offset-2 transition-colors hover:decoration-[var(--color-accent2)]"
                onclick={() => openExternal('https://www.last.fm/api/account/create')}
              >
                last.fm/api/account/create</button
              >.
            </p>
            <div class="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                bind:value={lastfmKey}
                placeholder="API key"
                class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60"
              />
              <input
                bind:value={lastfmSecret}
                type="password"
                placeholder="Shared secret"
                class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[var(--color-accent)]/60"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                class="cherry-btn-scrim flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-accent2)] disabled:opacity-40"
                disabled={lastfmBusy || !lastfmKey.trim() || !lastfmSecret.trim()}
                onclick={connectLastfm}
              >
                <i class="bx bx-link-external"></i>
                {lastfmBusy ? 'Working…' : lastfmToken ? 'Restart authorization' : 'Connect Last.fm'}
              </button>
              {#if lastfmToken}
                <button
                  class="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/5 disabled:opacity-40"
                  disabled={lastfmBusy}
                  onclick={finishLastfm}
                >
                  I’ve authorized
                </button>
              {/if}
            </div>
            {#if lastfmMessage}
              <p class="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-300">
                <i class="bx bx-check-circle mt-0.5 shrink-0"></i>{lastfmMessage}
              </p>
            {/if}
            {#if lastfmError}
              <p class="mt-2 flex items-start gap-1.5 text-[11px] text-rose-300">
                <i class="bx bx-error-circle mt-0.5 shrink-0"></i>{lastfmError}
              </p>
            {/if}
          {/if}
        </div>
      </div>
    </SettingsSection>

    <!-- Cherry -->
    <h2 class="mt-6 text-[18px] font-extrabold tracking-tight text-white sm:text-[20px]">Cherry</h2>
    <!-- Appearance -->
    <SettingsSection
      title="Appearance"
      description="Theme, accent colour and zoom."
      icon="bx bx-palette"
    >
      <div class="flex flex-col gap-5">
        <div>
          <div class="mb-2 text-[12px] font-semibold text-zinc-200">Theme</div>
          <div class="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {#each THEME_OPTIONS as option (option.value)}
              <button
                class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors {$settingsStore.theme ===
                option.value
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-white'}"
                onclick={() => updateSettings({ theme: option.value })}
              >
                <i class={option.icon}></i>{option.label}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-2 text-[12px] font-semibold text-zinc-200">Accent colour</div>
          <div class="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {#each ACCENT_SOURCE_OPTIONS as option (option.value)}
              <button
                class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors {$settingsStore.accentSource ===
                option.value
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-white'}"
                onclick={() => updateSettings({ accentSource: option.value })}
              >
                <i class={option.icon}></i>{option.label}
              </button>
            {/each}
          </div>
          {#if $settingsStore.accentSource === 'custom'}
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={$settingsStore.accentColor}
                oninput={(e) =>
                  updateSettings({ accentColor: (e.currentTarget as HTMLInputElement).value })}
                class="h-8 w-10 cursor-pointer rounded-md border border-white/10 bg-transparent"
                aria-label="Accent colour"
              />
              <div class="flex items-center gap-1.5">
                {#each ACCENT_PRESETS as preset (preset)}
                  <button
                    class="h-6 w-6 rounded-full border border-white/15 transition-transform hover:scale-110"
                    style="background: {preset}"
                    title={preset}
                    aria-label={`Accent ${preset}`}
                    onclick={() => updateSettings({ accentColor: preset })}
                  ></button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[12px] font-semibold text-zinc-200">Zoom</span>
            <span class="text-[11px] tabular-nums text-zinc-500">{Math.round(zoomValue * 100)}%</span>
          </div>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoomValue}
            style="--fill: {zoomFillPercent(zoomValue)}%"
            class="cherry-range cherry-range-always w-full"
            aria-label="UI zoom"
            oninput={(e) => {
              zoomDraft = Number((e.currentTarget as HTMLInputElement).value);
              applyZoom(zoomDraft);
            }}
            onchange={() => {
              if (zoomDraft !== null) {
                void updateSettings({ uiZoom: zoomDraft });
                zoomDraft = null;
              }
            }}
          />
          <!-- Visible step markers, aligned to the handle's travel (half a thumb
               in from each end). -->
          <div class="pointer-events-none mt-1.5 flex justify-between px-[6px]">
            {#each ZOOM_STEPS as step (step)}
              <span
                class="h-1.5 w-px rounded-full {Math.abs(step - zoomValue) < ZOOM_STEP / 2
                  ? 'bg-[var(--color-accent2)]'
                  : 'bg-white/15'}"
              ></span>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-2 text-[12px] font-semibold text-zinc-200">Background</div>
          <label class="flex items-center justify-between gap-4">
            <span class="flex items-center gap-2 text-[12px] text-zinc-300"><i class="bx bx-droplet shrink-0 text-sm text-zinc-500"></i>Accent gradients</span>
            <Toggle
              checked={$settingsStore.gradientsEnabled}
              label="Background gradients"
              onchange={(value) => updateSettings({ gradientsEnabled: value })}
            />
          </label>
        </div>
      </div>
    </SettingsSection>

    <!-- Application -->
    <section class="rounded-xl border border-white/[0.06] bg-[var(--color-card)] p-5">
      <div>
        <label class="flex items-center justify-between gap-4 py-3 first:pt-0">
          <span class="flex items-center gap-2 text-[12px] text-zinc-300"><i class="bx bx-layout shrink-0 text-sm text-zinc-500"></i>Compact sidebar</span>
          <Toggle
            checked={$settingsStore.compactSidebar}
            label="Compact sidebar"
            onchange={(value) => updateSettings({ compactSidebar: value })}
          />
        </label>
        <label class="flex items-center justify-between gap-4 py-3 last:pb-0">
          <span class="flex items-center gap-2 text-[12px] text-zinc-300"><i class="bx bx-window shrink-0 text-sm text-zinc-500"></i>Minimize to tray</span>
          <Toggle
            checked={$settingsStore.minimizeToTray}
            label="Minimize to tray"
            onchange={(value) => updateSettings({ minimizeToTray: value })}
          />
        </label>
      </div>
    </section>

    <!-- Data and cache -->
    <SettingsSection
      title="Data &amp; Cache"
      description="Everything Cherry keeps on this device."
      icon="bx bx-data"
    >
      <div class="flex items-center justify-between gap-4 text-[12px]">
        <span class="text-zinc-300">Your settings, playlist cache, sign-in info</span>
        <span class="shrink-0 text-[11px] tabular-nums text-zinc-500">{cacheLabel}</span>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
          disabled={clearing || clearingCache}
          onclick={clearCacheOnly}
        >
          <i class="bx bx-reset"></i>
          {clearingCache ? 'Clearing…' : 'Clear cache'}
        </button>
        <button
          class="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
          disabled={clearing || clearingCache}
          onclick={clearData}
        >
          <i class="bx bx-trash"></i>
          {clearing ? 'Clearing…' : 'Clear everything'}
        </button>
      </div>
      {#if clearNotice}<p class="mt-2 text-[11px] text-emerald-300">{clearNotice}</p>{/if}
    </SettingsSection>

    <!-- Developer -->
    <SettingsSection
      title="Developer"
      description="Debug tools for Cherry itself."
      icon="bx bx-code-alt"
    >
      <div>
        <label class="flex items-center justify-between gap-4 py-3 first:pt-0">
          <span class="flex items-center gap-2 text-[12px] text-zinc-300"><i class="bx bx-code shrink-0 text-sm text-zinc-500"></i>Enable developer tools</span>
          <Toggle
            checked={$settingsStore.devToolsEnabled}
            label="Developer tools"
            onchange={(value) => updateSettings({ devToolsEnabled: value })}
          />
        </label>
        <div class="flex items-center justify-between gap-4 py-3 last:pb-0">
          <span class="flex items-center gap-2 text-[12px] text-zinc-300">
            <i class="bx bx-code-alt shrink-0 text-sm text-zinc-500"></i>WebView DevTools
            <span class="text-zinc-600">(F12)</span>
          </span>
          <div class="flex gap-2">
            <button
              class="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
              disabled={!$settingsStore.devToolsEnabled || !isTauri()}
              onclick={() => openDevTools()}
            >
              Open DevTools
            </button>
            <button
              class="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              onclick={reloadFrontend}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    </SettingsSection>

    <!-- About -->
    <h2 class="mt-6 text-[18px] font-extrabold tracking-tight text-white sm:text-[20px]">About</h2>
    <!-- Disclaimer (shown above the Cherry info) -->
    <SettingsSection title="Disclaimer" tone="warn" icon="bx bxs-info-circle">
      <p class="text-[11px] leading-relaxed text-amber-100/80">{DISCLAIMER}</p>
    </SettingsSection>

    <!-- About -->
    <section class="rounded-xl border border-[var(--color-accent)]/25 bg-gradient-to-br from-[var(--color-accent)]/10 to-transparent p-5">
      <div class="flex items-start gap-3">
        <img src={logoUrl} alt="Cherry" class="h-10 w-10 shrink-0 rounded-xl shadow-lg" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-zinc-300">
            <span class="font-bold text-white">Cherry</span>
            <span class="text-zinc-500">by</span>
            <button
              class="font-semibold text-[var(--color-accent2)] underline decoration-[var(--color-accent2)]/30 underline-offset-2 transition-colors hover:decoration-[var(--color-accent2)]"
              onclick={openInaneTools}
            >
              inane.tools
            </button>
          </div>
          <p class="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            [ hit me up google, lets make a better youtube music for everyone ]
          </p>
        </div>
        <span
          class="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-300"
          title={`Cherry ${__APP_VERSION__} · build ${__CHERRY_BUILD__}`}
        >v{__APP_VERSION__}</span>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <img src={inaneWordmark} alt="inane.tools" class="inane-wordmark h-6 w-auto opacity-80" />
        <div class="flex items-center gap-1.5">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            title="@inanetools on X"
            aria-label="X (Twitter)"
            onclick={() => openExternal('https://x.com/inanetools')}
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path
                d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
              />
            </svg>
          </button>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            title="GitHub repository"
            aria-label="GitHub repository"
            onclick={() => openExternal('https://github.com/inane-tools/cherry')}
          >
            <i class="bx bxl-github text-lg"></i>
          </button>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            title="inane.tools"
            aria-label="inane.tools website"
            onclick={() => openExternal('https://inane.tools')}
          >
            <i class="bx bx-globe text-lg"></i>
          </button>
        </div>
      </div>
    </section>

    <!-- Licenses, credits and third-party software -->
    <SettingsSection
      title="Open source"
      description="Cherry is built on these projects. Each is used under its own license."
      icon="bx bx-code-alt"
      collapsible
    >
      <ul class="grid grid-cols-1 gap-x-6 text-[11px] text-zinc-400 sm:grid-cols-2">
        {#each [
          { name: 'Tauri', use: 'desktop shell, windowing, OS integration', license: 'MIT / Apache-2.0', url: 'https://github.com/tauri-apps/tauri' },
          { name: 'Svelte', use: 'UI framework', license: 'MIT', url: 'https://github.com/sveltejs/svelte' },
          { name: 'Vite', use: 'build tooling', license: 'MIT', url: 'https://github.com/vitejs/vite' },
          { name: 'Tailwind CSS', use: 'styling', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
          { name: 'youtubei.js', use: 'YouTube / YouTube Music (Innertube) API', license: 'MIT', url: 'https://github.com/LuanRT/YouTube.js' },
          { name: 'souvlaki', use: 'OS media controls (SMTC / MPRIS)', license: 'MIT', url: 'https://github.com/Sinono3/souvlaki' },
          { name: 'discord-rich-presence', use: 'Discord Rich Presence', license: 'MIT', url: 'https://github.com/EmbarkStudios/discord-rich-presence' },
          { name: 'Boxicons', use: 'icon set', license: 'CC BY 4.0', url: 'https://github.com/atisawd/boxicons' },
          { name: 'Zalando Sans', use: 'typeface', license: 'OFL-1.1', url: 'https://github.com/zalando/sans' },
          { name: 'keyring', use: 'OS credential storage', license: 'MIT / Apache-2.0', url: 'https://github.com/hwchen/keyring-rs' },
          { name: 'serde / reqwest / tokio', use: 'Rust serialization, HTTP, async runtime', license: 'MIT / Apache-2.0', url: 'https://github.com/serde-rs/serde' },
          { name: 'md5', use: 'Last.fm API request signing', license: 'Apache-2.0 / MIT', url: 'https://github.com/ivan-ukhov/rust-md5' },
          { name: 'sha1', use: 'SAPISIDHASH (playlist image upload)', license: 'MIT / Apache-2.0', url: 'https://github.com/RustCrypto/hashes' },
          { name: 'webview2-com', use: 'WebView2 memory trimming', license: 'MIT', url: 'https://github.com/wravery/webview2-rs' },
          { name: 'windows-rs', use: 'Windows API bindings', license: 'MIT / Apache-2.0', url: 'https://github.com/microsoft/windows-rs' },
        ] as dep}
          <li class="flex items-baseline justify-between gap-2 py-1.5">
            <a
              class="font-medium text-zinc-300 transition-colors hover:text-white"
              href={dep.url}
              onclick={(e) => {
                e.preventDefault();
                openExternal(dep.url);
              }}>{dep.name}</a>
            <span class="truncate text-right text-[10px] text-zinc-600" title={`${dep.use} · ${dep.license}`}>{dep.license}</span>
          </li>
        {/each}
      </ul>
    </SettingsSection>
  </div>
</div>
