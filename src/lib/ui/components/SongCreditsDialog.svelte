<script lang="ts">
  import { fly, fade } from '$lib/ui/transitions';
  import { thumbnailSources, trackDisplayArtists } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import DialogHeader from './DialogHeader.svelte';
  import { closeSongCredits, songCreditsStore } from '$lib/app/services/songCredits';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';

  $: state = $songCreditsStore;
  $: track = state.track;
  $: art = track ? thumbnailSources(track.thumbnails, 128) : [];

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeSongCredits();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if state.open && track}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim/60 p-4 backdrop-blur-[3px]"
    role="presentation"
    onclick={closeSongCredits}
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 120 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--color-popover)] shadow-[0_30px_80px_rgba(0,0,0,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-label="Song credits"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      in:fly={{ y: -12, duration: 180 }}
      out:fade={{ duration: 120 }}
    >
      <DialogHeader title="Song credits" onClose={closeSongCredits} />

      <div class="flex shrink-0 items-center gap-3 px-6 pb-6">
        <span class="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--color-art)]">
          {#if art.length}
            <img use:artwork={{ urls: art }} alt="" class="h-full w-full object-cover" />
          {:else}
            <span class="flex h-full w-full items-center justify-center text-zinc-600">
              <i class="bx bx-music text-lg"></i>
            </span>
          {/if}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-semibold text-white">{track.title}</p>
          <p class="mt-0.5 truncate text-[12px] text-zinc-500">{trackDisplayArtists(track)}</p>
        </div>
      </div>

      <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-6 pb-6">
        {#if state.loading}
          <p class="py-6 text-center text-[12px] text-zinc-500">Loading credits…</p>
        {:else if state.error}
          <p class="py-6 text-center text-[12px] text-rose-300">{state.error}</p>
        {:else if state.sections.length > 0}
          <div class="flex flex-col gap-5">
            {#each state.sections as section, i (i)}
              <div>
                <h3 class="text-[13px] font-semibold text-white">
                  {section.title}
                </h3>
                <div class="mt-1.5 flex flex-col gap-1">
                  {#each section.entries as entry, j (j)}
                    <span class="text-[12px] leading-relaxed text-zinc-400">{entry}</span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="py-6 text-center text-[12px] text-zinc-500">
            No credits available for this song.
            <div class="mt-1 text-[11px] text-zinc-600">
              Credits appear only when the label provides them.
            </div>
          </div>
        {/if}
      </div>

    </div>
  </div>
{/if}
