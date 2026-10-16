<script lang="ts">
  import { videoMode, videoPreferred, videoResolution, setVideoMode, playerStore } from '$lib/app/services/player';
  import { videoQualities, pickVideoRepresentation } from '$lib/app/services/videoQuality';
  import { settingsStore, updateSettings } from '$lib/app/services/settings';
  import Dropdown from './Dropdown.svelte';

  $: quality = $settingsStore.videoQuality;
  $: fallbackHeight = pickVideoRepresentation($videoQualities.map(height => ({ id: String(height), height, bandwidth: 0 })), quality)?.height;
  $: fallbackLabel = $videoResolution || fallbackHeight ? `${$videoResolution ?? fallbackHeight}p*` : 'Loading…';
  $: options = [
    { value: 'highest', label: `Highest${$videoQualities[0] ? ` · ${$videoQualities[0]}p` : ''}` },
    { value: 'auto', label: `Auto${$videoResolution ? ` · ${$videoResolution}p` : ''}` },
    ...$videoQualities.map(height => ({ value: String(height), label: `${height}p` })),
    ...(!['auto', 'highest'].includes(quality) && !$videoQualities.includes(Number(quality))
      ? [{ value: quality, label: fallbackLabel }] : []),
  ];
  $: title = $videoPreferred
    ? $videoMode ? `Switch to audio${$videoResolution ? ` · ${$videoResolution}p` : ''}` : 'Video enabled · unavailable for this track'
    : 'Watch music video';
</script>

  <div class="flex shrink-0 items-center gap-2">
    {#if $videoMode}
      <Dropdown value={quality} {options} variant="player" ariaLabel="Video quality"
        onchange={(videoQuality) => void updateSettings({ videoQuality })} />
    {:else if $videoPreferred && $playerStore.status !== 'loading'}
      <span class="flex h-9 items-center rounded-full bg-[var(--player-header-background)] px-3 text-xs text-zinc-400 backdrop-blur">No video</span>
    {/if}
    <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--player-header-background)] text-xl backdrop-blur transition-colors hover:bg-[var(--color-surface)] {$videoPreferred ? 'text-[var(--color-accent)]' : 'text-white'}"
      disabled={!$playerStore.track} {title} aria-label={title}
      aria-pressed={$videoPreferred} onclick={() => setVideoMode(!$videoPreferred)}>
      <i class="bx bx-video" aria-hidden="true"></i>
    </button>
  </div>
