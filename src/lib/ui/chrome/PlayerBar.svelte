<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { coordinateArtworkPresentation } from '$lib/app/services/theme';
  import { artwork } from '$lib/ui/actions/artwork';
  import { preloadArtwork } from '$lib/ui/actions/preloadArtwork';
  import { playerStore, toggle, next, prev, seekTo, setVolume, setMuted, toggleShuffle } from '$lib/app/services/player';
  import { shuffleMode, upNext } from '$lib/app/services/queue';
  import { bestThumbnail, hiResThumbnail, thumbnailSources, expandedArtworkSources, trackDisplayArtists, type Track } from '$lib/core/models';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { trackMenu } from '$lib/app/services/menus';
  import { playerExpanded, expandedPlayerPanel } from '$lib/app/services/layout';
  import { searchOpen, settingsOpen } from '$lib/app/services/overlays';
  import { queueSidebarVisible } from '$lib/app/services/queueSidebar';
  import { settingsStore } from '$lib/app/services/settings';
  import { fly, fade } from '$lib/ui/transitions';
  import ArtistsLine from '$lib/ui/components/ArtistsLine.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { frameOpacity } from '$lib/ui/actions/frameOpacity';
  import { videoControls } from '$lib/ui/actions/videoControls';
  import UpNextPanel from './UpNextPanel.svelte';
  import QueueList from './QueueList.svelte';
  import QueueHeader from './QueueHeader.svelte';
  import RepeatButton from '$lib/ui/components/RepeatButton.svelte';
  import { lyricsStore } from '$lib/app/services/lyrics';
  import LyricsView from '$lib/ui/components/LyricsView.svelte';
  import PlaybackExtras from '$lib/ui/components/PlaybackExtras.svelte';
  import VideoControls from '$lib/ui/components/VideoControls.svelte';
  import { videoMode, videoSurface, videoReady, playbackBuffering } from '$lib/app/services/player';
  import PlaybackIcon from '$lib/ui/components/PlaybackIcon.svelte';
  import SleepTimerButton from '$lib/ui/components/SleepTimerButton.svelte';

  let upNextOpen = false;
  let volOpen = false;
  let compactPlayerHeight = 88;
  const COMPACT_PLAYER_INSET = 16;
  function measureCompactPlayer(node: HTMLElement) {
    const measure = () => { compactPlayerHeight = node.offsetHeight; };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return { destroy() { observer.disconnect(); } };
  }
  let presentationHost: HTMLDivElement;
  let playerFullscreen = false;
  let fullscreenError = '';
  async function togglePlayerFullscreen() {
    fullscreenError = '';
    try {
      if (document.fullscreenElement === presentationHost) await document.exitFullscreen();
      else await presentationHost.requestFullscreen();
    } catch { fullscreenError = 'Could not change fullscreen. Try again.'; }
  }
  function exitPlayerFullscreen() {
    if (document.fullscreenElement === presentationHost) void document.exitFullscreen().catch(() => {});
  }
  onMount(() => {
    const changed = () => { playerFullscreen = document.fullscreenElement === presentationHost; };
    document.addEventListener('fullscreenchange', changed);
    return () => { document.removeEventListener('fullscreenchange', changed); exitPlayerFullscreen(); };
  });
  $: if (playerFullscreen && (!$playerExpanded || $searchOpen || $settingsOpen)) exitPlayerFullscreen();
  $: showQueueButton = !$queueSidebarVisible && ($settingsStore.playerShowQueue || $settingsStore.queueSidebar);
  $: if ($queueSidebarVisible) upNextOpen = false;
  $: if ($queueSidebarVisible && $expandedPlayerPanel === 'queue') expandedPlayerPanel.set('art');
  $: if ($videoMode && $expandedPlayerPanel === 'lyrics') expandedPlayerPanel.set('art');

  $: st = $playerStore;
  $: pct = st.durationSeconds > 0 ? (st.positionSeconds / st.durationSeconds) * 100 : 0;
  // Position/volume ticks reuse the same metadata. Do not rebuild thumbnail
  // candidates or preload requests unless the actual track object changes.
  let artworkTrack: Track | null = null;
  $: if (artworkTrack !== st.track) artworkTrack = st.track;
  $: cover = artworkTrack ? bestThumbnail(artworkTrack.thumbnails, 512) : '';
  // A larger source for the full-screen background (falls back to `cover`).
  $: bgCover = cover ? hiResThumbnail(cover, 1080) : '';
  // The square art is shown large enough that the mid-res cover looks soft, so
  // upscale to a hi-res source, with the supplied sizes as fallbacks.
  $: squareCover = cover ? hiResThumbnail(cover, 720) : '';
  $: coverSources = thumbnailSources(artworkTrack?.thumbnails ?? [], 512);
  let preloadKey = '';
  let clearPreload = () => {};
  $: {
    const groups = [1080, 720].map(size => expandedArtworkSources(artworkTrack?.thumbnails ?? [], size));
    const key = JSON.stringify(groups);
    if (key !== preloadKey) {
      preloadKey = key;
      clearPreload();
      const requestedBackground = bgCover;
      const requestedSquare = squareCover;
      clearPreload = preloadArtwork(groups, (urls, image) => {
        if (urls[0] === requestedBackground) onPendingLoad(image, requestedBackground);
        if (urls[0] === requestedSquare) onSquareLoad(image, requestedSquare);
      });
    }
  }
  onDestroy(() => clearPreload());
  // First track in the play order after the current one (for the "Next up" chip).
  $: nextItem = $upNext[0] ?? null;
  $: nextArt = nextItem ? bestThumbnail(nextItem.track.thumbnails, 96) : '';
  let videoFrame: HTMLDivElement;
  // Keep the persistent video on exactly the same animation clock as the card.
  function playerFly(node: Element, options: { y: number; duration: number }) {
    const config = fly(node, options);
    return { ...config, tick(t: number, u: number) {
      config.tick?.(t, u);
      if (videoFrame) {
        videoFrame.style.transform = `translateY(${options.y * u}px)`;
        videoFrame.style.opacity = String(t);
      }
    } };
  }

  // ── Background-art crossfade ────────────────────────────────────────────
  // Two layers: `baseArt` is the last cover that actually loaded and stays on
  // screen; `pendingArt` fades in on top once it loads. Keeping the previous
  // cover underneath is what stops the dark card flashing between tracks — and
  // on first open, where the cached mid-res cover shows immediately.
  let baseArt = '';
  let pendingArt = '';
  let pendingLoaded = false;
  let artTrackId: string | null | undefined = undefined;
  // Promotes the pending cover to the base only *after* its crossfade finishes;
  // promoting on load swapped the base instantly and defeated the fade (the
  // "pops in" symptom).
  let promoteTimer: ReturnType<typeof setTimeout> | null = null;
  // Square art fades in when it has decoded, not on mount (otherwise a slow
  // image pops in after the transition has already run). Reset per URL, so two
  // tracks that share the same cover don't blink.
  let squareLoaded = false;
  let squareArtUrl = '';
  let squareBaseArt = '';
  let squarePromoteTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundDecoded = false;
  let squareDecoded = false;
  let decodedBackground = '';
  let decodedSquare = '';
  let releaseTheme: (() => void) | null = null;
  let presentationFallback: ReturnType<typeof setTimeout> | null = null;
  let presentationStarted = false;
  let preparedThemeUrl = '';
  function beginPresentation(force = false) {
    if (presentationStarted) { releaseTheme?.(); releaseTheme = null; return; }
    const expandedAudio = $playerExpanded && !$videoMode;
    const artVisible = expandedAudio && $expandedPlayerPanel === 'art';
    if (!force && (!backgroundDecoded || (artVisible && !squareDecoded))) return;
    if (!force && expandedAudio && $settingsStore.accentSource === 'song' && !releaseTheme
      && preparedThemeUrl !== bestThumbnail(st.track?.thumbnails ?? [], 256)) return;
    presentationStarted = true;
    if (presentationFallback) clearTimeout(presentationFallback);
    presentationFallback = null;
    pendingLoaded = backgroundDecoded;
    squareLoaded = squareDecoded;
    if (backgroundDecoded) {
      const url = pendingArt;
      const loaded = decodedBackground;
      if (promoteTimer) clearTimeout(promoteTimer);
      promoteTimer = setTimeout(() => { if (url === pendingArt) baseArt = loaded; promoteTimer = null; }, 320);
    }
    if (squareDecoded) {
      const url = squareArtUrl;
      const loaded = decodedSquare;
      if (squarePromoteTimer) clearTimeout(squarePromoteTimer);
      squarePromoteTimer = setTimeout(() => { if (url === squareArtUrl) squareBaseArt = loaded; squarePromoteTimer = null; }, 320);
    }
    releaseTheme?.(); releaseTheme = null;
  }
  onMount(() => coordinateArtworkPresentation(async url => {
    await tick();
    if (url !== bestThumbnail(st.track?.thumbnails ?? [], 256)) return;
    preparedThemeUrl = url;
    if (!$playerExpanded || $videoMode) return;
    await new Promise<void>(resolve => {
      releaseTheme?.();
      releaseTheme = resolve;
      beginPresentation();
    });
  }));
  $: if (!$playerExpanded || $videoMode || $settingsStore.accentSource !== 'song') beginPresentation(true);
  $: if ($playerExpanded && !$videoMode && $expandedPlayerPanel !== 'art') beginPresentation();

  $: {
    const id = st.track ? `${st.track.videoId}:${bgCover}` : null;
    if (id !== artTrackId) {
      artTrackId = id;
      pendingLoaded = false;
      backgroundDecoded = false;
      squareDecoded = squareCover === squareArtUrl && squareLoaded;
      presentationStarted = false;
      releaseTheme?.(); releaseTheme = null;
      if (presentationFallback) clearTimeout(presentationFallback);
      presentationFallback = setTimeout(() => beginPresentation(true), 5000);
      if (promoteTimer) {
        clearTimeout(promoteTimer);
        promoteTimer = null;
      }
      if (cover) {
        pendingArt = bgCover;
        if (!baseArt) baseArt = cover;
      } else {
        pendingArt = '';
        baseArt = '';
      }
    }
  }

  $: if (squareCover !== squareArtUrl) {
    squareArtUrl = squareCover;
    squareLoaded = false;
    if (squarePromoteTimer) clearTimeout(squarePromoteTimer);
    squarePromoteTimer = null;
  }
  $: if (!st.track || (!cover && st.status !== 'loading')) squareBaseArt = '';

  function onSquareLoad(image: HTMLImageElement, requested: string): void {
    if (requested !== squareArtUrl) return;
    squareDecoded = true;
    const loadedUrl = image.currentSrc || image.src;
    decodedSquare = loadedUrl;
    if (!presentationStarted) { beginPresentation(); return; }
    squareLoaded = true;
    if (squarePromoteTimer) clearTimeout(squarePromoteTimer);
    squarePromoteTimer = setTimeout(() => {
      squarePromoteTimer = null;
      if (requested === squareArtUrl) squareBaseArt = loadedUrl;
    }, 320);
  }

  function onPendingLoad(image: HTMLImageElement, requested: string): void {
    if (requested !== pendingArt) return;
    backgroundDecoded = true;
    const url = pendingArt;
    const loadedUrl = image.currentSrc || image.src;
    decodedBackground = loadedUrl;
    if (!presentationStarted) { beginPresentation(); return; }
    pendingLoaded = true;
    if (promoteTimer) clearTimeout(promoteTimer);
    promoteTimer = setTimeout(() => {
      promoteTimer = null;
      if (pendingArt === url) baseArt = loadedUrl;
    }, 320);
  }

  onDestroy(() => {
    if (promoteTimer) clearTimeout(promoteTimer);
    if (squarePromoteTimer) clearTimeout(squarePromoteTimer);
    if (presentationFallback) clearTimeout(presentationFallback);
    releaseTheme?.();
  });

  function fmt(s: number): string {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  function onSeek(e: Event) {
    seekTo(Number((e.target as HTMLInputElement).value));
  }
  function onVol(e: Event) {
    setVolume(Number((e.target as HTMLInputElement).value));
  }

  // Right-click the currently playing track for the same menu as track rows.
  function onTrackContext(event: MouseEvent) {
    if (!st.track) return;
    openContextMenu(event, trackMenu(st.track));
  }

  function expand() {
    upNextOpen = false;
    playerExpanded.set(true);
  }

  function compactFly(node: Element) {
    return fly(node, { y: node.getBoundingClientRect().height + COMPACT_PLAYER_INSET + 8, opacity: 1, duration: 280 });
  }
</script>

<!-- Keep the media node connected when the expanded presentation is removed. -->
<div bind:this={presentationHost} class="player-presentation">
<div bind:this={videoFrame} style:opacity="0" class="video-frame pointer-events-none absolute inset-x-3 bottom-0 top-14 z-[25] overflow-hidden rounded-t-3xl">
  <div class="absolute inset-0 bg-black {$videoMode ? '' : 'invisible'}">
    <div use:videoSurface use:frameOpacity={{ visible: $videoMode && $videoReady, duration: 220 }}
      class:letterboxed={$settingsStore.videoLetterboxing}
      class="absolute inset-0 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none {$videoMode && $videoReady ? 'opacity-100' : 'opacity-0'}"></div>
  </div>
</div>

{#if $playerExpanded}
  <!-- Full-screen now-playing card. It is a floating card *below* the top bar
       (never underneath it) over a dimmed content column, so the sidebar and top
       bar stay accessible. -->
  <div
    class="absolute inset-0 z-20 bg-scrim/40 backdrop-blur-sm"
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 150 }}
  ></div>
  <div
    style:background={$videoMode ? ($videoReady ? 'transparent' : '#000') : undefined}
    use:videoControls={{ enabled: $videoMode && $videoReady && st.status === 'playing' && $expandedPlayerPanel === 'art' && !$playbackBuffering && !fullscreenError }}
    class="expanded-player cherry-playerbar absolute inset-x-3 bottom-0 top-14 z-30 flex flex-col overflow-hidden rounded-t-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
    oncontextmenu={onTrackContext}
    role="presentation"
    in:playerFly={{ y: 36, duration: 280 }}
    out:playerFly={{ y: 36, duration: 200 }}
  >
    <!-- Album art as a full-bleed, dimmed background. Two layers so the
         previous cover stays visible until the next one has loaded. -->
    {#if $videoMode}
      <div class="video-control-chrome pointer-events-none absolute inset-x-0 bottom-0 top-[15%] -z-10 bg-gradient-to-t from-black via-black/60 to-transparent"></div>
    {:else if cover}
      {#if baseArt}
        <img
          use:artwork={{ urls: [baseArt] }}
          alt=""
          class="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover blur-3xl"
        />
      {/if}
      {#if pendingArt}
        {#key artTrackId}
          {@const requestedBackground = pendingArt}
          <img
            use:artwork={{ urls: expandedArtworkSources(st.track?.thumbnails ?? [], 1080) }}
            alt=""
            use:frameOpacity={{ visible: pendingLoaded, duration: 300 }}
            class="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover blur-3xl transition-opacity duration-300 {pendingLoaded ? 'opacity-100' : 'opacity-0'}"
            onload={(event) => onPendingLoad(event.currentTarget as HTMLImageElement, requestedBackground)}
          />
        {/key}
      {/if}
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 top-[15%] -z-10 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/75 to-transparent"
      ></div>
    {/if}

    <div use:frameOpacity={{ visible: $expandedPlayerPanel !== 'art', duration: 240 }}
      class="pointer-events-none absolute inset-0 -z-10 bg-black/55 transition-opacity duration-[240ms] motion-reduce:transition-none {$expandedPlayerPanel !== 'art' ? 'opacity-100' : 'opacity-0'}"></div>

    <div data-video-controls class="expanded-header video-control-chrome video-control-top grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 p-3">
      <div class="expanded-header-next min-w-0">
      {#if nextItem && !upNextOpen}
        <div
          class="flex h-9 w-fit min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-full bg-[var(--player-header-background)] pr-3 backdrop-blur"
          title={`Next up: ${nextItem.track.title}`}
        >
          <span class="h-9 w-9 shrink-0 bg-white/5">
            {#if nextArt}
              <img use:artwork={{ urls: thumbnailSources(nextItem?.track.thumbnails ?? [], 96) }} alt="" class="h-full w-full object-cover" />
            {:else}
              <span class="flex h-full w-full items-center justify-center text-zinc-600">
                <i class="ph-duotone ph-music-notes"></i>
              </span>
            {/if}
          </span>
          <span class="min-w-0">
            <span class="block text-[11px] leading-tight text-zinc-400">Next up</span>
            <span class="block truncate text-[12px] font-medium leading-tight text-zinc-100">{nextItem.track.title}</span>
          </span>
        </div>
      {/if}
      </div>
      <div class="expanded-header-tabs flex justify-center">
          <div class="player-view-switch flex h-9 items-center gap-1 rounded-full p-1 backdrop-blur" role="group" aria-label="Expanded player view">
            <button class="h-7 rounded-full px-3 text-xs font-semibold transition-colors {$expandedPlayerPanel === 'art' ? 'bg-[var(--color-accent)] text-[#fff]' : 'text-zinc-300 hover:text-white'}"
              aria-pressed={$expandedPlayerPanel === 'art'} onclick={() => expandedPlayerPanel.set('art')}>{$videoMode ? 'Video' : 'Art'}</button>
            {#if !$queueSidebarVisible}
            <button class="h-7 rounded-full px-3 text-xs font-semibold transition-colors {$expandedPlayerPanel === 'queue' ? 'bg-[var(--color-accent)] text-[#fff]' : 'text-zinc-300 hover:text-white'}"
              aria-pressed={$expandedPlayerPanel === 'queue'} onclick={() => expandedPlayerPanel.set('queue')}>Queue</button>
            {/if}
            {#if !$videoMode}
            <button class="h-7 rounded-full px-3 text-xs font-semibold transition-colors {$expandedPlayerPanel === 'lyrics' ? 'bg-[var(--color-accent)] text-[#fff]' : 'text-zinc-300 hover:text-white'}"
              aria-pressed={$expandedPlayerPanel === 'lyrics'} onclick={() => expandedPlayerPanel.set('lyrics')}>Lyrics</button>
            {/if}
          </div>
      </div>
      <div class="expanded-header-actions flex shrink-0 items-center justify-self-end gap-2">
      <VideoControls />
      <button
        class="cherry-nav-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white backdrop-blur transition-colors"
        title="Collapse player"
        aria-label="Collapse player"
        onclick={() => playerExpanded.set(false)}
      >
        <i class="ph ph-caret-down text-2xl"></i>
      </button>
      </div>
    </div>

    {#if !$videoMode || $expandedPlayerPanel === 'queue'}
      <div class="mx-auto mb-6 flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-hidden sm:mb-8">
        {#key $expandedPlayerPanel}
          <div in:fade={{ duration: 160 }} class="flex min-h-0 flex-1 flex-col">
            {#if $expandedPlayerPanel === 'art'}
              <div class="art-frame flex min-h-0 flex-1 items-center justify-center px-6 py-4">
                {#if squareCover || squareBaseArt}
                  <div class="player-square-art relative overflow-hidden rounded-2xl shadow-lg">
                    {#if squareBaseArt}
                      <img use:artwork={{ urls: [squareBaseArt] }} alt="" class="absolute inset-0 h-full w-full object-cover" />
                    {/if}
                    {#if squareCover}
                      {#key squareCover}
                        {@const requested = squareCover}
                        <img use:artwork={{ urls: expandedArtworkSources(st.track?.thumbnails ?? [], 720) }} alt={st.track?.title ?? 'Album art'}
                          use:frameOpacity={{ visible: squareLoaded, duration: 300 }}
                          class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 {squareLoaded ? 'opacity-100' : 'opacity-0'}"
                          onload={(event) => onSquareLoad(event.currentTarget as HTMLImageElement, requested)} />
                      {/key}
                    {/if}
                  </div>
                {:else}
                  <i class="ph-duotone ph-music-notes text-7xl text-zinc-500" aria-label="No album art"></i>
                {/if}
              </div>
            {:else if $expandedPlayerPanel === 'queue'}
              <QueueHeader />
              <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-3 pb-3"><QueueList /></div>
            {:else}
              <LyricsView expanded transparent />
            {/if}
          </div>
        {/key}
      </div>
    {:else}
      <div class="min-h-0 flex-1"></div>
    {/if}

    <div data-video-controls class="video-control-chrome video-control-bottom relative w-full shrink-0 px-12 pb-3 sm:px-8">
      <div class="mx-auto max-w-2xl">
        <div class="text-center" oncontextmenu={onTrackContext} role="presentation">
          {#if st.track}
            <div class="truncate text-2xl font-bold text-white" title={st.track.title}>{st.track.title}</div>
            <div class="mt-1.5 truncate text-sm text-zinc-400" title={trackDisplayArtists(st.track)}>
              <ArtistsLine artists={st.track.artists} />{#if st.track.album?.name}<span class="text-zinc-600">{' · '}{st.track.album.name}</span>{/if}
            </div>
          {/if}
        </div>

        <div class="mt-5 flex items-center gap-3">
          <span class="w-10 shrink-0 text-left text-[11px] tabular-nums text-zinc-300"
            >{st.isLive ? 'LIVE' : fmt(st.positionSeconds)}</span
          >
          <input
            type="range"
            min="0"
            max={Math.max(1, st.durationSeconds, st.positionSeconds)}
            step="0.5"
            value={st.positionSeconds}
            disabled={st.isLive}
            oninput={onSeek}
            class="cherry-range min-w-0 flex-1"
            style="--fill: {pct}%"
            title={`Full length ${st.isLive ? 'LIVE' : fmt(st.durationSeconds)}`}
            aria-label="Seek"
          />
          <span class="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-300"
            >{st.isLive ? 'LIVE' : fmt(st.durationSeconds)}</span
          >
        </div>

        <!-- Main playback controls. -->
        <div class="mt-5 flex items-center justify-center gap-1 sm:gap-6">
          {#if $settingsStore.playerShowPrev}
            <button
              class="flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-full text-xl text-zinc-200 hover:text-white"
              onclick={prev}
              title="Previous"
              aria-label="Previous"
            >
              <i class="ph-fill ph-skip-back"></i>
            </button>
          {/if}
          <button
            class="player-accent-gradient cherry-btn-scrim flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-accent)] text-xl text-white transition-colors duration-300"
            onclick={toggle}
            title={st.status === 'playing' ? 'Pause' : 'Play'}
            aria-label={st.status === 'loading' ? 'Cancel loading' : st.status === 'playing' ? 'Pause' : 'Play'}
            aria-busy={st.status === 'loading' || $playbackBuffering}
          >
            <PlaybackIcon loading={st.status === 'loading' || $playbackBuffering} playing={st.status === 'playing'} />
          </button>
          <button
            class="flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-full text-xl text-zinc-200 hover:text-white"
            onclick={() => next()}
            title="Next"
            aria-label="Next"
          >
            <i class="ph-fill ph-skip-forward"></i>
          </button>
        </div>

        <!-- Secondary controls stay below the transport. -->
        <div class="mt-4 flex flex-wrap items-center justify-center gap-3 sm:gap-5">
          {#if $settingsStore.playerShowShuffle}
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-xl {$shuffleMode
                ? 'text-[var(--color-accent2)]'
                : 'text-zinc-400 hover:text-white'}"
              onclick={toggleShuffle}
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={$shuffleMode}
            >
              <i class="{$shuffleMode ? 'ph-fill' : 'ph'} ph-shuffle"></i>
            </button>
          {/if}
          {#if $settingsStore.playerShowRepeat}<RepeatButton size="lg" />{/if}
          {#if $settingsStore.playerShowSleepTimer}<SleepTimerButton size="lg" />{/if}
        </div>

        {#if st.error || fullscreenError}
          <p class="mt-3 text-center text-[11px] text-red-400" title={st.error || fullscreenError}>{st.error || fullscreenError}</p>
        {/if}
      </div>
      <button
        class="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-xl text-zinc-400 hover:text-white transition-colors"
        title={playerFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        aria-label={playerFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        aria-pressed={playerFullscreen}
        onclick={togglePlayerFullscreen}
      >
        <i class="ph {playerFullscreen ? 'ph-corners-in' : 'ph-corners-out'}" aria-hidden="true"></i>
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions : hover wrapper for the volume popup -->
      <div
        class="absolute bottom-3 left-3 flex items-center"
        onmouseenter={() => (volOpen = true)}
        onmouseleave={() => (volOpen = false)}
      >
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-zinc-400 hover:text-white transition-colors"
          onclick={() => setMuted(!st.muted)}
          title="Mute"
          aria-label="Mute"
        >
          {#if st.muted || st.volume === 0}
            <i class="ph-fill ph-speaker-slash"></i>
          {:else if st.volume < 0.5}
            <i class="ph ph-speaker-low"></i>
          {:else}
            <i class="ph ph-speaker-high"></i>
          {/if}
        </button>
        <div
          use:frameOpacity={{ visible: volOpen, duration: 150 }}
          class="absolute bottom-full left-0 z-10 flex w-9 justify-center rounded-lg bg-[var(--color-popover)] px-2 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-opacity duration-150 {volOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'}"
        >
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={st.muted ? 0 : st.volume}
            oninput={onVol}
            class="cherry-range-v"
            style="--fill: {(st.muted ? 0 : st.volume) * 100}%"
            aria-label="Volume"
          />
        </div>
      </div>

    </div>
  </div>
{:else}
  <!-- Fade behind the floating bar so content trails off at the bottom. Uses
       the (tinted) surface colour rather than pure black, and stays subtle. -->
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/60 to-transparent"
  ></div>

  <footer
    transition:compactFly
    use:measureCompactPlayer
    class="compact-player-shell cherry-playerbar pointer-events-auto absolute inset-x-3 z-30 rounded-3xl"
    style:bottom={`${COMPACT_PLAYER_INSET}px`}
  >
    {#if !$videoMode && $settingsStore.lyricsEnabled && st.track && $lyricsStore.status === 'ready' && $lyricsStore.data}
      <div transition:fly={{ y: 8, duration: 180 }} class="absolute bottom-full left-1/2 mb-2 w-max max-w-[min(36rem,calc(100%-1rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-[var(--color-popover)] shadow-lg"><LyricsView /></div>
    {/if}
    <div class="compact-player-content">
      <div
        class="compact-player-info relative flex min-w-0 items-center gap-3 rounded-xl bg-[var(--chrome-control-background)] px-2"
        style:background={$settingsStore.tintedBackground ? 'color-mix(in srgb, var(--color-surface) 92%, var(--color-white) 8%)' : undefined}
      >
        <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
          <div class="player-accent-gradient absolute inset-0 origin-left opacity-20" style:transform={`scaleX(${pct / 100})`}></div>
        </div>
        <input
          type="range" min="0" max={Math.max(1, st.durationSeconds, st.positionSeconds)} step="0.5"
          value={st.positionSeconds} disabled={st.isLive} oninput={onSeek} oncontextmenu={onTrackContext}
          class="compact-info-seek absolute inset-0 z-10 m-0 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-default"
          title={`Full length ${st.isLive ? 'LIVE' : fmt(st.durationSeconds)}`} aria-label="Seek"
        />
        <button
          class="group relative z-20 h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white/5"
          title="Expand player"
          aria-label="Expand player"
          onclick={expand}
          oncontextmenu={onTrackContext}
        >
          {#if cover}
            <img use:artwork={{ urls: coverSources }} alt="" class="h-full w-full object-cover" />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-zinc-600">
              <i class="ph-duotone ph-music-notes text-2xl"></i>
            </div>
          {/if}
          <span
            class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <i class="ph ph-caret-up text-2xl text-white"></i>
          </span>
        </button>
        <div class="pointer-events-none relative z-20 min-w-0 flex-1 text-left" oncontextmenu={onTrackContext} role="presentation">
          {#if st.track}
            <div class="min-w-0">
              <div class="truncate text-[13px] font-semibold leading-tight text-zinc-100" title={st.track.title}>
                {st.track.title}
              </div>
              <div class="mt-0.5 truncate text-[11px] leading-tight text-zinc-400" title={trackDisplayArtists(st.track)}>
                <ArtistsLine artists={st.track.artists} textClass="pointer-events-auto" />{#if st.track.album?.name}<span class="text-zinc-600">{' · '}{st.track.album.name}</span>{/if}
              </div>
            </div>
          {/if}
        </div>
        <span class="pointer-events-none relative z-20 shrink-0 pr-2 text-[10px] leading-none tabular-nums text-zinc-400">
          {#if st.isLive}LIVE{:else}{fmt(st.positionSeconds)} / {fmt(st.durationSeconds)}{/if}
        </span>
      </div>

      <div class="compact-player-transport">
        <div class="compact-player-controls compact-player-buttons flex items-center justify-start">
          {#if $settingsStore.playerShowShuffle}
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-xl {$shuffleMode ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
              onclick={toggleShuffle}
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={$shuffleMode}
            >
              <i class="{$shuffleMode ? 'ph-fill' : 'ph'} ph-shuffle"></i>
            </button>
          {/if}
          {#if $settingsStore.playerShowPrev}
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-lg text-zinc-200 hover:text-white"
              onclick={prev}
              title="Previous"
              aria-label="Previous"
            >
              <i class="ph-fill ph-skip-back"></i>
            </button>
          {/if}
          <button
            class="player-accent-gradient cherry-btn-scrim flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-xl text-white"
            onclick={toggle}
            title={st.status === 'playing' ? 'Pause' : 'Play'}
            aria-label={st.status === 'loading' ? 'Cancel loading' : st.status === 'playing' ? 'Pause' : 'Play'}
            aria-busy={st.status === 'loading' || $playbackBuffering}
          >
            <PlaybackIcon loading={st.status === 'loading' || $playbackBuffering} playing={st.status === 'playing'} />
          </button>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-lg text-zinc-200 hover:text-white"
            onclick={() => next()}
            title="Next"
            aria-label="Next"
          >
            <i class="ph-fill ph-skip-forward"></i>
          </button>
          {#if $settingsStore.playerShowRepeat}<RepeatButton size="lg" />{/if}
        </div>
      </div>

      <div class="compact-player-extras compact-player-buttons flex items-center justify-end">
        {#if $settingsStore.playerShowSleepTimer}<SleepTimerButton size="lg" compact />{/if}
        <PlaybackExtras />
        {#if showQueueButton}
          <button
            data-upnext-toggle
            class="flex h-9 w-9 items-center justify-center rounded-full text-xl {upNextOpen ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
            title="Queue"
            aria-label="Queue"
            aria-pressed={upNextOpen}
            onclick={() => (upNextOpen = !upNextOpen)}
          >
            <i class="ph ph-queue"></i>
          </button>
        {/if}

        <!-- svelte-ignore a11y_no_static_element_interactions : hover wrapper for the volume popup -->
        <div
          class="relative flex items-center"
          onmouseenter={() => (volOpen = true)}
          onmouseleave={() => (volOpen = false)}
        >
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-zinc-400 hover:text-white"
            onclick={() => setMuted(!st.muted)}
            title="Mute"
            aria-label="Mute"
          >
            {#if st.muted || st.volume === 0}
              <i class="ph-fill ph-speaker-slash"></i>
            {:else if st.volume < 0.5}
              <i class="ph ph-speaker-low"></i>
            {:else}
              <i class="ph ph-speaker-high"></i>
            {/if}
          </button>

          <div
            use:frameOpacity={{ visible: volOpen, duration: 150 }}
            class="absolute bottom-full right-0 z-10 flex w-9 justify-center rounded-lg bg-[var(--color-popover)] px-2 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-opacity duration-150 {volOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'}"
          >
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={st.muted ? 0 : st.volume}
              oninput={onVol}
              class="cherry-range-v"
              style="--fill: {(st.muted ? 0 : st.volume) * 100}%"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
      {#if st.error}
        <p class="compact-player-error truncate text-center text-[10px] text-red-400" title={st.error}>{st.error}</p>
      {/if}
    </div>
  </footer>
{/if}

<!-- Queue panel, shared by the bar and the full-screen card. -->
<UpNextPanel open={upNextOpen && !$playerExpanded} bottom={compactPlayerHeight + COMPACT_PLAYER_INSET + 8} onClose={() => (upNextOpen = false)} />
</div>

<style>
  .compact-player-shell { container-type: inline-size; --compact-player-button-gap: 4px; }
  .compact-player-buttons { gap: var(--compact-player-button-gap); }
  .compact-player-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'info info' 'transport extras';
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
  }
  .compact-player-info { grid-area: info; height: 52px; }
  .player-accent-gradient { background-image: linear-gradient(180deg, var(--color-accent), var(--color-accent2)); }
  .compact-player-info:has(.compact-info-seek:focus-visible) { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .compact-info-seek { appearance: none; -webkit-appearance: none; background: transparent; }
  .compact-info-seek::-webkit-slider-runnable-track { height: 100%; }
  .compact-info-seek::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 0; height: 100%; }
  .compact-player-transport { display: contents; }
  .compact-player-controls { grid-area: transport; justify-self: start; }
  .compact-player-extras {
    grid-area: extras;
    align-self: center;
    justify-self: end;
    min-height: 36px;
    /* Match the visible volume glyph to the artwork edge, while retaining
       the full 36px target and the same gaps between adjacent buttons. */
    margin-inline-end: -8px;
  }
  .compact-player-error { grid-column: 1 / -1; }
  @container (min-width: 720px) {
    .compact-player-content {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: 'transport info extras';
      grid-template-rows: 52px;
    }
  }
  .player-presentation { display: contents; }
  .player-presentation:fullscreen { display: block; position: fixed; inset: 0; width: 100%; height: 100%; background: black; }
  .player-presentation:fullscreen .video-frame, .player-presentation:fullscreen .expanded-player { inset: 0; border-radius: 0; }
  .video-control-chrome { transition: opacity 240ms cubic-bezier(0.37, 0, 0.63, 1); }
  .video-control-top, .video-control-bottom { transform: translateY(0); transition: opacity 240ms cubic-bezier(0.37, 0, 0.63, 1), transform 320ms cubic-bezier(0.22, 1, 0.36, 1); }
  .expanded-player { container-type: inline-size; }
  :global(html:not(.light)) .expanded-header {
    --chrome-control-background: color-mix(in srgb, var(--color-surface) 65%, transparent);
    --chrome-control-hover-background: color-mix(in srgb, var(--color-surface) 80%, transparent);
    --player-header-background: var(--chrome-control-background);
  }
  :global(html.light) .expanded-header {
    --chrome-control-background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    --chrome-control-hover-background: color-mix(in srgb, var(--color-surface) 95%, transparent);
    --player-header-background: var(--chrome-control-background);
  }
  @container (max-width: 680px) {
    .expanded-header { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'next actions' 'tabs tabs'; gap: 8px 12px; }
    .expanded-header-next { grid-area: next; }
    .expanded-header-tabs { grid-area: tabs; }
    .expanded-header-actions { grid-area: actions; }
  }
  .expanded-player:global([data-video-idle]) { cursor: none; }
  .expanded-player:global([data-video-idle]) .video-control-chrome { opacity: 0; pointer-events: none; }
  .expanded-player:global([data-video-idle]) .video-control-top { transform: translateY(calc(-100% - 12px)); }
  .expanded-player:global([data-video-idle]) .video-control-bottom { transform: translateY(calc(100% + 12px)); }
  @media (prefers-reduced-motion: reduce) { .video-control-chrome { transition: none; } }
  .expanded-player :global(.transition-colors) { transition-duration: 300ms; }
  .expanded-player :global(.text-zinc-400), .expanded-player :global(.text-zinc-500) { color: var(--color-zinc-200); }
  .expanded-player :global(.text-zinc-600) { color: var(--color-zinc-400); }
  .player-view-switch { background: var(--player-header-background); }
  .art-frame { container-type: size; }
  .player-square-art { width: min(100cqw, 100cqh, 22rem); height: min(100cqw, 100cqh, 22rem); aspect-ratio: 1; }
  .letterboxed { background: black; }
  .letterboxed :global(video) { object-fit: contain; }
</style>
