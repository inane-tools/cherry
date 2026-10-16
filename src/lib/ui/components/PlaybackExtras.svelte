<script lang="ts">
  import { lyricsStore, toggleLyrics } from '$lib/app/services/lyrics';
  import { videoMode } from '$lib/app/services/player';
  import { settingsStore } from '$lib/app/services/settings';
  $: lyricsAvailable = !$videoMode && ($lyricsStore.status === 'ready' || !!$lyricsStore.data);
  $: canToggle = !$videoMode && (lyricsAvailable || $settingsStore.lyricsEnabled);
  $: lyricsTitle = $videoMode ? 'Lyrics are unavailable in video mode'
    : $lyricsStore.status === 'loading' ? 'Loading lyrics…'
    : lyricsAvailable ? 'Lyrics' : 'Lyrics unavailable for this track';
</script>

{#if $settingsStore.playerShowLyrics}
<button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl disabled:cursor-default disabled:text-zinc-600 {lyricsAvailable && $settingsStore.lyricsEnabled ? 'text-[var(--color-accent)]' : 'text-zinc-400 enabled:hover:text-white'}"
  disabled={!canToggle} title={lyricsTitle} aria-label={lyricsTitle} aria-pressed={!!$settingsStore.lyricsEnabled} onclick={toggleLyrics}>
  <i class="bx bx-captions" aria-hidden="true"></i>
</button>
{/if}
