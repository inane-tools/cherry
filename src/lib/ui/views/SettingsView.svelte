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
  import { refreshDiscord } from '$lib/app/services/player';
  import { clearAllData, formatCacheSize } from '$lib/app/services/maintenance';
  import { DISCLAIMER } from '$lib/app/services/gate';
  import { isTauri } from '$lib/app/services/platform';
  import SettingsSection from '$lib/ui/components/SettingsSection.svelte';
  import Toggle from '$lib/ui/components/Toggle.svelte';
  // Bundled (hashed) rather than `/logo.png`: an absolute public path is served
  // by the asset protocol, which can 404 in the window right after the cache is
  // cleared. A build-time import always resolves to a real, versioned URL.
  import logoUrl from '$lib/assets/logo.png';

  // ── Clear data and cache ────────────────────────────────────────
  let cacheLabel = 'calculating…';
  let clearing = false;
  let clearNotice = '';

  async function refreshCacheLabel() {
    cacheLabel = await formatCacheSize();
  }
  refreshCacheLabel();

  async function clearData() {
    if (clearing) return;
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

  async function quitApp() {
    if (!isTauri()) return;
    const { exit } = await import('@tauri-apps/plugin-process');
    await exit(0);
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
    <!-- Account -->
    <SettingsSection title={name} description={`${profile?.handle ? `${profile.handle} · ` : ''}${$playlistStore.length} playlists`}>
      <span slot="leading" class="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#242333]">
        {#if profile?.avatarUrl}
          <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-sm font-bold text-[#13131a]">{initial}</span>
        {/if}
      </span>

      <span slot="action">
        {#if $authStore}
          <button
            class="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            onclick={disconnect}
          >
            Sign out
          </button>
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
                <span class="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-[#242333]">
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
        <div class="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
          <span class="text-[12px] text-zinc-300">Refresh playlists</span>
          <button
            class="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            disabled={$libraryLoading}
            onclick={refreshPlaylists}
          >
            <i class="bx bx-refresh" class:bx-spin={$libraryLoading}></i>
            {$libraryLoading ? 'Refreshing…' : 'Refresh'}
          </button>
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
      title="Discord Rich Presence"
      description="Show what you are listening to on your Discord profile."
      icon="bx bxl-discord-alt"
    >
      <div class="divide-y divide-white/[0.06]">
        <label class="flex items-center justify-between gap-4 py-3 first:pt-0">
          <span class="text-[12px] text-zinc-300">Enabled</span>
          <Toggle
            checked={$settingsStore.discordEnabled}
            label="Discord Rich Presence"
            onchange={setDiscordEnabled}
          />
        </label>
        <label class="flex items-center justify-between gap-4 py-3 last:pb-0">
          <span class="text-[12px] text-zinc-300">Show next to your name</span>
          <select
            value={$settingsStore.discordStatusDisplay}
            onchange={(e) => setStatusDisplay((e.currentTarget as HTMLSelectElement).value)}
            class="rounded-lg border border-white/10 bg-[#191820] px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors focus:border-[var(--color-accent)]/60"
          >
            <option value="details">Song title</option>
            <option value="state">Artist</option>
            <option value="name">App name</option>
          </select>
        </label>
      </div>
    </SettingsSection>

    <!-- Application -->
    <SettingsSection title="Application" description="How Cherry behaves on your desktop." icon="bx bx-desktop">
      <div class="divide-y divide-white/[0.06]">
        <label class="flex items-center justify-between gap-4 py-3 first:pt-0">
          <span class="text-[12px] text-zinc-300">Minimize to tray</span>
          <Toggle
            checked={$settingsStore.minimizeToTray}
            label="Minimize to tray"
            onchange={(value) => updateSettings({ minimizeToTray: value })}
          />
        </label>
        {#if isTauri()}
          <div class="flex items-center justify-between gap-4 py-3 last:pb-0">
            <span class="text-[12px] text-zinc-300">Quit Cherry</span>
            <button
              class="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              onclick={quitApp}
            >
              Quit
            </button>
          </div>
        {/if}
      </div>
    </SettingsSection>

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
      <button
        class="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
        disabled={clearing}
        onclick={clearData}
      >
        <i class="bx bx-trash"></i>
        {clearing ? 'Clearing…' : 'Clear data'}
      </button>
      <p class="mt-2 text-[10px] leading-relaxed text-zinc-600">
        The WebView cache folder may be locked while Cherry is running; it is removed on the next start.
      </p>
      {#if clearNotice}<p class="mt-2 text-[11px] text-emerald-300">{clearNotice}</p>{/if}
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
    </section>

    <!-- Disclaimer -->
    <SettingsSection title="Disclaimer" tone="warn" icon="bx bxs-info-circle">
      <p class="text-[11px] leading-relaxed text-amber-100/80">{DISCLAIMER}</p>
    </SettingsSection>

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
          { name: 'windows-rs', use: 'Windows API bindings', license: 'MIT / Apache-2.0', url: 'https://github.com/microsoft/windows-rs' },
        ] as dep}
          <li class="flex items-baseline justify-between gap-2 border-b border-white/[0.06] py-1.5">
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
      <p class="mt-3 text-[10px] leading-relaxed text-zinc-600">
        Full license texts ship with each project; Rust and npm dependencies are recorded in
        <code class="text-zinc-500">Cargo.lock</code> and
        <code class="text-zinc-500">package-lock.json</code>.
      </p>
    </SettingsSection>
  </div>
</div>
