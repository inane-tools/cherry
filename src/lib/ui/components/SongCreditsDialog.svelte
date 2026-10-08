<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { bestThumbnail, trackDisplayArtists } from '$lib/core/models';
  import { closeSongCredits, songCreditsStore } from '$lib/app/services/songCredits';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';

  $: state = $songCreditsStore;
  $: track = state.track;
  $: art = track ? bestThumbnail(track.thumbnails, 128) : '';

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
      <header class="flex items-center gap-3 px-5 py-4">
        <span class="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {#if art}
            <img src={art} alt="" class="h-full w-full object-cover" />
          {:else}
            <span class="flex h-full w-full items-center justify-center text-zinc-600">
              <i class="bx bx-music text-lg"></i>
            </span>
          {/if}
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[14px] font-semibold text-white">Song credits</h2>
          <p class="truncate text-[11px] text-zinc-500">
            {track.title} — {trackDisplayArtists(track)}
          </p>
        </div>
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
          onclick={closeSongCredits}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </header>

      <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-5 pb-5">
        {#if state.loading}
          <p class="py-6 text-center text-[12px] text-zinc-500">Loading credits…</p>
        {:else if state.error}
          <p class="py-6 text-center text-[12px] text-rose-300">{state.error}</p>
        {:else if state.sections.length > 0}
          <div class="flex flex-col gap-4">
            {#each state.sections as section, i (i)}
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {section.title}
                </div>
                <div class="mt-1 flex flex-col gap-0.5">
                  {#each section.entries as entry, j (j)}
                    <span class="text-[12px] text-zinc-200">{entry}</span>
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

      <footer class="flex items-center justify-end border-t border-white/[0.06] px-5 py-3">
        <button
          class="rounded-lg border border-white/10 px-4 py-1.5 text-[12px] text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          onclick={closeSongCredits}
        >
          Close
        </button>
      </footer>
    </div>
  </div>
{/if}
