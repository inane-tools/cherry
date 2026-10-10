<script lang="ts">
  import { playerStore, toggle, next, prev, seekTo, setVolume, setMuted, toggleShuffle } from '$lib/app/services/player';
  import { shuffleMode, upNext, upNextQueue, clearQueue, queueItems } from '$lib/app/services/queue';
  import { bestThumbnail, hiResThumbnail, trackDisplayArtists } from '$lib/core/models';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { trackMenu } from '$lib/app/services/menus';
  import { playerExpanded } from '$lib/app/services/layout';
  import { settingsStore } from '$lib/app/services/settings';
  import { fly, fade } from 'svelte/transition';
  import ArtistsLine from '$lib/ui/components/ArtistsLine.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import UpNextPanel from './UpNextPanel.svelte';
  import QueueList from './QueueList.svelte';
  import RepeatButton from '$lib/ui/components/RepeatButton.svelte';
  import SleepTimerButton from '$lib/ui/components/SleepTimerButton.svelte';

  let upNextOpen = false;
  let volOpen = false;

  $: st = $playerStore;
  $: pct = st.durationSeconds > 0 ? (st.positionSeconds / st.durationSeconds) * 100 : 0;
  $: cover = st.track ? bestThumbnail(st.track.thumbnails, 512) : '';
  // A larger source for the full-screen background (falls back to `cover`).
  $: bgCover = cover ? hiResThumbnail(cover, 1080) : '';
  // The square art is shown large enough that the mid-res cover looks soft, so
  // upscale to a hi-res source (falls back through `onArtError`).
  $: squareCover = cover ? hiResThumbnail(cover, 720) : '';
  // A guaranteed-loadable thumbnail for when the upscaled background URL 404s
  // (not every video has a `maxresdefault`, and `cover` itself can be that URL).
  $: fallbackCover = st.track ? bestThumbnail(st.track.thumbnails, 320) : '';
  // First track in the play order after the current one (for the "Next up" chip).
  $: nextItem = $upNext[0] ?? null;
  $: nextArt = nextItem ? bestThumbnail(nextItem.track.thumbnails, 96) : '';
  // Square album art above the title (Settings → Appearance).
  $: squareArt = $settingsStore.playerSquareArt;

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

  $: {
    const id = st.track?.videoId ?? null;
    if (id !== artTrackId) {
      artTrackId = id;
      pendingLoaded = false;
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
  }

  function onPendingLoad(): void {
    pendingLoaded = true;
    const url = pendingArt;
    if (promoteTimer) clearTimeout(promoteTimer);
    promoteTimer = setTimeout(() => {
      promoteTimer = null;
      if (pendingArt === url) baseArt = url;
    }, 520);
  }

  /**
   * Album-art fallback chain. The pending <img> is keyed per track, so
   * `dataset.tried` starts empty each time — the old code kept the flag across
   * tracks, which made a later track skip the mid-res fallback and show broken
   * art.
   */
  function onArtError(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    const candidates = [cover, fallbackCover].filter(Boolean);
    let tried: string[] = [];
    try {
      tried = img.dataset.tried ? (JSON.parse(img.dataset.tried) as string[]) : [];
    } catch {
      tried = [];
    }
    if (!tried.includes(img.src)) tried.push(img.src);
    const next = candidates.find((url) => !tried.includes(url));
    img.dataset.tried = JSON.stringify(tried);
    if (next) img.src = next;
    else img.style.visibility = 'hidden';
  }

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
</script>

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
    class="cherry-playerbar absolute inset-x-3 bottom-0 top-14 z-30 flex flex-col overflow-hidden rounded-t-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
    oncontextmenu={onTrackContext}
    role="presentation"
    in:fly={{ y: 48, duration: 240 }}
    out:fly={{ y: 48, duration: 180 }}
  >
    <!-- Album art as a full-bleed, dimmed background. Two layers so the
         previous cover stays visible until the next one has loaded. -->
    {#if cover}
      {#if baseArt}
        <img
          src={baseArt}
          alt=""
          class="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover {squareArt
            ? 'scale-110 blur-3xl'
            : ''}"
          onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
      {/if}
      {#if pendingArt}
        {#key artTrackId}
          <img
            src={pendingArt}
            alt=""
            class="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover transition-opacity duration-500 {squareArt
              ? 'scale-110 blur-3xl'
              : ''} {pendingLoaded ? 'opacity-100' : 'opacity-0'}"
            onload={onPendingLoad}
            onerror={onArtError}
          />
        {/key}
      {/if}
      <div
        class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/75 to-[var(--color-surface)]/25"
      ></div>
    {/if}

    <div class="flex shrink-0 items-center gap-3 p-3">
      {#if nextItem && !upNextOpen}
        <div
          class="flex h-9 min-w-0 items-center gap-3 overflow-hidden rounded-lg bg-[var(--color-elevated)]/70 pr-3 backdrop-blur"
          title={`Next up: ${nextItem.track.title}`}
        >
          <span class="h-9 w-9 shrink-0 bg-white/5">
            {#if nextArt}
              <img src={nextArt} alt="" class="h-full w-full object-cover" />
            {:else}
              <span class="flex h-full w-full items-center justify-center text-zinc-600">
                <i class="bx bx-music"></i>
              </span>
            {/if}
          </span>
          <span class="min-w-0">
            <span class="block text-[11px] leading-tight text-zinc-400">Next up</span>
            <span class="block truncate text-[12px] font-medium leading-tight text-zinc-100">{nextItem.track.title}</span>
          </span>
        </div>
      {/if}
      <button
        class="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-elevated)]/70 text-white backdrop-blur transition-colors hover:bg-[var(--color-elevated)]"
        title="Collapse player"
        aria-label="Collapse player"
        onclick={() => playerExpanded.set(false)}
      >
        <i class="bx bx-chevron-down text-2xl"></i>
      </button>
    </div>

    {#if upNextOpen}
      <!-- Queue shown inline in the middle of the full-screen card. -->
      <div
        class="mx-auto mb-2 flex min-h-0 w-full max-w-2xl flex-1 flex-col rounded-2xl bg-[var(--color-elevated)]/50 p-4 backdrop-blur-md"
      >
        <div class="flex shrink-0 items-center gap-3 pb-2">
          <h2 class="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">Queue</h2>
          <span
            class="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400"
          >
            {$upNextQueue.length} up next
          </span>
          {#if $queueItems.length > 0}
            <button
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              aria-label="Clear queue"
              title="Clear queue"
              onclick={clearQueue}
            >
              <i class="bx bx-trash text-lg"></i>
            </button>
          {/if}
        </div>
        <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1">
          <QueueList />
        </div>
      </div>
    {:else}
      <!-- Empty spacer normally; when the square-art option is on, the cover is
           centred in this middle area. -->
      <div class="flex min-h-0 flex-1 items-center justify-center px-8 pb-6">
        {#if squareArt && cover}
          <div
            class="aspect-square h-full max-h-[22rem] overflow-hidden rounded-2xl shadow-[0_18px_50px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
          >
            {#key squareCover}
              <img
                src={squareCover}
                alt=""
                class="h-full w-full object-cover transition-opacity duration-300 {squareLoaded
                  ? 'opacity-100'
                  : 'opacity-0'}"
                onload={() => (squareLoaded = true)}
                onerror={onArtError}
              />
            {/key}
          </div>
        {/if}
      </div>
    {/if}

    <div class="mx-auto w-full max-w-2xl shrink-0 px-8 pb-8">
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
          >{fmt(st.positionSeconds)}</span
        >
        <input
          type="range"
          min="0"
          max={Math.max(1, st.durationSeconds, st.positionSeconds)}
          step="0.5"
          value={st.positionSeconds}
          oninput={onSeek}
          class="cherry-range min-w-0 flex-1"
          style="--fill: {pct}%"
          title={`Full length ${fmt(st.durationSeconds)}`}
          aria-label="Seek"
        />
        <span class="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-300"
          >{fmt(st.durationSeconds)}</span
        >
      </div>

      <!-- Main controls -->
      <div class="mt-5 flex items-center justify-center gap-6">
        {#if $settingsStore.playerShowPrev}
          <button
            class="flex h-12 w-12 items-center justify-center rounded-full text-4xl text-zinc-200 hover:text-white"
            onclick={prev}
            title="Previous"
            aria-label="Previous"
          >
            <i class="bx bx-skip-previous"></i>
          </button>
        {/if}
        <button
          class="cherry-btn-scrim flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-accent)] text-4xl text-white"
          onclick={toggle}
          title={st.status === 'playing' ? 'Pause' : 'Play'}
          aria-label={st.status === 'playing' ? 'Pause' : 'Play'}
        >
          {#if st.status === 'playing'}
            <i class="bx bx-pause"></i>
          {:else}
            <i class="bx bx-play"></i>
          {/if}
        </button>
        <button
          class="flex h-12 w-12 items-center justify-center rounded-full text-4xl text-zinc-200 hover:text-white"
          onclick={() => next()}
          title="Next"
          aria-label="Next"
        >
          <i class="bx bx-skip-next"></i>
        </button>
      </div>

      <!-- Secondary controls -->
      <div class="mt-4 flex items-center justify-center gap-5">
        {#if $settingsStore.playerShowShuffle}
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-xl {$shuffleMode
              ? 'text-[var(--color-accent2)]'
              : 'text-zinc-400 hover:text-white'}"
            onclick={toggleShuffle}
            title="Shuffle"
            aria-label="Shuffle"
          >
            <i class="bx bx-shuffle"></i>
          </button>
        {/if}
        {#if $settingsStore.playerShowRepeat}<RepeatButton size="lg" />{/if}
        {#if $settingsStore.playerShowSleepTimer}<SleepTimerButton size="lg" />{/if}
        {#if $settingsStore.playerShowQueue}
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-xl {upNextOpen
              ? 'text-[var(--color-accent2)]'
              : 'text-zinc-400 hover:text-white'}"
            onclick={() => (upNextOpen = !upNextOpen)}
            title="Queue"
            aria-label="Queue"
          >
            <i class="bx bx-list-ul"></i>
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
              <i class="bx bx-volume-mute"></i>
            {:else if st.volume < 0.5}
              <i class="bx bx-volume-low"></i>
            {:else}
              <i class="bx bx-volume-full"></i>
            {/if}
          </button>
          <div
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
        <p class="mt-3 text-center text-[11px] text-red-400" title={st.error}>{st.error}</p>
      {/if}
    </div>
  </div>
{:else}
  <!-- Fade behind the floating bar so content trails off at the bottom. Uses
       the (tinted) surface colour rather than pure black, and stays subtle. -->
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)]/60 to-transparent"
  ></div>

  <footer
    class="cherry-playerbar pointer-events-auto absolute inset-x-3 bottom-0 z-30 rounded-t-xl shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
  >
    <div class="flex w-full flex-wrap items-center gap-2 p-3 sm:gap-4">
      <!-- Album art doubles as the "expand player" button; the chevron shows on
           hover. Right-click still opens the track menu. -->
      <button
        class="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5 sm:h-16 sm:w-16"
        title="Expand player"
        aria-label="Expand player"
        onclick={expand}
        oncontextmenu={onTrackContext}
      >
        {#if cover}
          <img src={cover} alt="" class="h-full w-full object-cover" />
        {:else}
          <div class="flex h-full w-full items-center justify-center text-zinc-600">
            <i class="bx bx-music text-2xl"></i>
          </div>
        {/if}
        <span
          class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <i class="bx bx-chevron-up text-2xl text-white"></i>
        </span>
      </button>

      <!-- Track info + scrub, sitting right of the art. -->
      <div
        class="flex min-w-0 flex-1 flex-col justify-center gap-1.5 self-stretch"
        oncontextmenu={onTrackContext}
        role="presentation"
      >
        {#if st.track}
          <div class="min-w-0">
            <div class="truncate text-[14px] font-semibold leading-tight text-zinc-100" title={st.track.title}>
              {st.track.title}
            </div>
            <div class="mt-0.5 truncate text-[11px] leading-tight text-zinc-400" title={trackDisplayArtists(st.track)}>
              <ArtistsLine artists={st.track.artists} />{#if st.track.album?.name}<span class="text-zinc-600">{' · '}{st.track.album.name}</span>{/if}
            </div>
          </div>
        {/if}

        <div class="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max={Math.max(1, st.durationSeconds, st.positionSeconds)}
            step="0.5"
            value={st.positionSeconds}
            oninput={onSeek}
            class="cherry-range min-w-0 flex-1"
            style="--fill: {pct}%"
            title={`Full length ${fmt(st.durationSeconds)}`}
            aria-label="Seek"
          />
          <span class="shrink-0 text-[10px] tabular-nums text-zinc-500">{fmt(st.positionSeconds)}</span>
        </div>
      </div>

      <!-- Controls. On small widths the transport is left-aligned and every
           other button (shuffle, repeat, sleep timer, queue, volume) sits on the
           right. On wider widths it sits inline, right-aligned as
           [transport][shuffle][queue][volume]. -->
      <div class="flex w-full items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-1">
        <!-- Second (wide): shuffle -->
        <div class="order-2 flex items-center gap-3 sm:order-2 sm:gap-1">
          {#if st.error}
            <span class="max-w-40 truncate text-[10px] leading-tight text-red-400" title={st.error}>{st.error}</span>
          {/if}
          {#if $settingsStore.playerShowShuffle}
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-lg {$shuffleMode ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
              onclick={toggleShuffle}
              title="Shuffle"
              aria-label="Shuffle"
            >
              <i class="bx bx-shuffle"></i>
            </button>
          {/if}
          {#if $settingsStore.playerShowRepeat}<RepeatButton />{/if}
          {#if $settingsStore.playerShowSleepTimer}<SleepTimerButton />{/if}
        </div>

        <!-- Left (small) / first (wide): transport. The negative margin on small
             screens offsets the button's own inset so the first icon lines up
             with the album art. -->
        <div class="order-1 -ml-1.5 mr-auto flex items-center gap-1 sm:order-1 sm:mr-0 sm:-ml-2">
          {#if $settingsStore.playerShowPrev}
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-2xl text-zinc-200 hover:text-white"
              onclick={prev}
              title="Previous"
              aria-label="Previous"
            >
              <i class="bx bx-skip-previous"></i>
            </button>
          {/if}
          <button
            class="cherry-btn-scrim flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)] text-2xl text-white"
            onclick={toggle}
            title={st.status === 'playing' ? 'Pause' : 'Play'}
            aria-label={st.status === 'playing' ? 'Pause' : 'Play'}
          >
            {#if st.status === 'playing'}
              <i class="bx bx-pause"></i>
            {:else}
              <i class="bx bx-play"></i>
            {/if}
          </button>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full text-2xl text-zinc-200 hover:text-white"
            onclick={() => next()}
            title="Next"
            aria-label="Next"
          >
            <i class="bx bx-skip-next"></i>
          </button>
        </div>

        <!-- Right (small) / third (wide): queue + volume -->
        <div class="order-3 -mr-2 flex items-center gap-1 sm:order-3">
          {#if $settingsStore.playerShowQueue}
            <button
              data-upnext-toggle
              class="flex h-9 w-9 items-center justify-center rounded-full text-xl {upNextOpen ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
              title="Queue"
              aria-label="Queue"
              onclick={() => (upNextOpen = !upNextOpen)}
            >
              <i class="bx bx-list-ul"></i>
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
                <i class="bx bx-volume-mute"></i>
              {:else if st.volume < 0.5}
                <i class="bx bx-volume-low"></i>
              {:else}
                <i class="bx bx-volume-full"></i>
              {/if}
            </button>

            <div
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
      </div>
    </div>
  </footer>
{/if}

<!-- Queue panel, shared by the bar and the full-screen card. -->
<UpNextPanel open={upNextOpen && !$playerExpanded} onClose={() => (upNextOpen = false)} />
