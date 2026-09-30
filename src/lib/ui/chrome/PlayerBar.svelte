<script lang="ts">
  import { playerStore, toggle, next, prev, seekTo, setVolume, setMuted } from '$lib/app/services/player';
  import { shuffleMode, setShuffle } from '$lib/app/services/queue';
  import { bestThumbnail, trackDisplayArtists } from '$lib/core/models';
  import { openContextMenu } from '$lib/app/services/contextMenu';
  import { trackMenu } from '$lib/app/services/menus';
  import ArtistsLine from '$lib/ui/components/ArtistsLine.svelte';
  import UpNextPanel from './UpNextPanel.svelte';

  let upNextOpen = false;
  let volOpen = false;

  $: st = $playerStore;
  $: pct = st.durationSeconds > 0 ? (st.positionSeconds / st.durationSeconds) * 100 : 0;
  $: cover = st.track ? bestThumbnail(st.track.thumbnails, 256) : '';

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
</script>

<!-- Black fade behind the floating bar so content trails off at the bottom. -->
<div
  class="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-gradient-to-t from-black via-black/70 to-transparent"
></div>

<footer
  class="cherry-playerbar pointer-events-auto absolute inset-x-3 bottom-3 z-30 rounded-xl border border-white/10 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
>
  <div class="flex w-full items-center gap-4 p-3">
    <!-- Album art, larger and pinned to the left. -->
    <div
      class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10"
      oncontextmenu={onTrackContext}
      role="presentation"
    >
      {#if cover}
        <img src={cover} alt="" class="h-full w-full object-cover" />
      {:else}
        <div class="flex h-full w-full items-center justify-center text-zinc-600">
          <i class="bx bx-music text-2xl"></i>
        </div>
      {/if}
    </div>

    <!-- Track info + scrub, sitting right of the art so the scrub ends next to
         it and spans across to the transport. Right-click for the track menu. -->
    <!-- `self-stretch` makes the column exactly as tall as the album art, so
         `justify-center` centres the title/artist/seek group against the art
         rather than against its own (shorter) content box. -->
    <div
      class="flex min-w-0 flex-1 flex-col justify-center gap-1.5 self-stretch"
      oncontextmenu={onTrackContext}
      role="presentation"
    >
      {#if st.track}
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold leading-tight text-zinc-100" title={st.track.title}>
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

    <!-- Transport + extras, right-aligned. -->
    <div class="flex shrink-0 items-center gap-3">
      <div class="flex items-center gap-1">
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-2xl text-zinc-200 hover:text-white"
          onclick={prev}
          title="Previous"
          aria-label="Previous"
        >
          <i class="bx bx-skip-previous"></i>
        </button>
        <button
          class="cherry-btn-scrim flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)] text-2xl text-white transition-transform hover:scale-105"
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

      <div class="flex items-center gap-1">
        {#if st.error}
          <span class="max-w-40 truncate text-[10px] leading-tight text-red-400" title={st.error}>{st.error}</span>
        {/if}
        <button
          class="flex h-9 w-9 items-center justify-center rounded-full text-xl {$shuffleMode ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
          onclick={() => setShuffle(!$shuffleMode)}
          title="Shuffle"
          aria-label="Shuffle"
        >
          <i class="bx bx-shuffle"></i>
        </button>
        <button
          data-upnext-toggle
          class="flex h-9 w-9 items-center justify-center rounded-full text-xl {upNextOpen ? 'text-[var(--color-accent2)]' : 'text-zinc-400 hover:text-white'}"
          title="Queue"
          aria-label="Queue"
          onclick={() => (upNextOpen = !upNextOpen)}
        >
          <i class="bx bx-list-ul"></i>
        </button>

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

          <!-- Volume slider pops up above the icon, aligned to its right edge
               with uniform padding. -->
          <div
            class="absolute bottom-full right-0 z-10 flex w-9 justify-center rounded-lg border border-white/10 bg-[var(--color-popover)] px-2 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-opacity duration-150 {volOpen
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

<!-- Floats above the player bar. -->
<UpNextPanel open={upNextOpen} onClose={() => (upNextOpen = false)} />
