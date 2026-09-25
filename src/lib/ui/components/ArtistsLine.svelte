<script lang="ts">
  import type { ArtistRef } from '$lib/core/models';
  import { openArtist } from '$lib/app/services/catalog';

  /**
   * Artist names for a track, each linked to its artist page when a browse id
   * is known. Names without a channel id (e.g. some feed rows) stay plain text.
   *
   * Clicks stop propagating so the button doesn't also trigger the row's play
   * handler.
   */
  export let artists: ArtistRef[] = [];
  /** Extra classes for the wrapping span (truncation, colour, …). */
  export let textClass = '';

  function open(artist: ArtistRef, event: MouseEvent): void {
    event.stopPropagation();
    openArtist(artist);
  }
</script>

<span class={textClass}>
  {#if artists.length === 0}
    Unknown artist
  {:else}
    {#each artists as artist, i}{#if artist.browseId}<button
          type="button"
          class="inline cursor-pointer underline-offset-2 transition-colors hover:text-white hover:underline"
          title={`Open ${artist.name}`}
          onkeydown={(e) => e.stopPropagation()}
          onclick={(e) => open(artist, e)}
        >{artist.name}</button>{:else}<span>{artist.name}</span>{/if}{#if i < artists.length - 1}{', '}{/if}{/each}
  {/if}
</span>
