<script lang="ts">
  import { thumbnailSources, type Thumbnail } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import { entityBackdrop } from '$lib/ui/actions/entityBackdrop';
  import { fade } from '$lib/ui/transitions';

  export let thumbnails: Thumbnail[] = [];
  export let banner: Thumbnail[] = [];
  export let round = false;
  export let condensed = false;
  export let loading = false;
  export let actions = true;
  export let aside = false;
  export let fallbackIcon = 'ph-duotone ph-music-notes';
  export let onContextMenu: ((event: MouseEvent) => void) | undefined = undefined;

  $: coverUrls = thumbnailSources(thumbnails, 512);
  $: backdropUrls = thumbnailSources(banner.length ? banner : thumbnails, 1440);
  let coverReady = false;
  let coverFailed = false;
  let bannerReady = false;
  let previousCover = '', previousBanner = '';
  $: coverKey = coverUrls.join('\n');
  $: bannerKey = backdropUrls.join('\n');
  $: if (coverKey !== previousCover) { previousCover = coverKey; coverReady = coverFailed = false; }
  $: if (bannerKey !== previousBanner) { previousBanner = bannerKey; bannerReady = false; }
  let wasLoading = false, loadingSince = 0, revealDuration = 0;
  $: if (loading !== wasLoading) {
    if (loading) loadingSince = performance.now();
    else revealDuration = performance.now() - loadingSince >= 100 ? 180 : 0;
    wasLoading = loading;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions : supplemental entity context menu -->
<header class="entity-header relative isolate mb-6 {condensed ? 'pt-4 sm:pt-10' : 'pt-20 sm:pt-28'}" aria-busy={loading} oncontextmenu={onContextMenu}>
  {#if backdropUrls.length}
    <div use:entityBackdrop class="entity-backdrop pointer-events-none absolute -inset-x-6 -top-6 bottom-0 -z-10 overflow-hidden" aria-hidden="true">
      <img use:artwork={{ urls: backdropUrls }} alt="" onload={() => (bannerReady = true)} class="h-full w-full object-cover object-[center_30%] transition-opacity duration-300 motion-reduce:transition-none {banner.length ? '' : 'scale-110 blur-2xl'} {bannerReady ? (banner.length ? 'opacity-60' : 'opacity-45') : 'opacity-0'}" />
      <div class="absolute inset-0 bg-[var(--color-surface)]/25"></div>
    </div>
  {/if}
  <div class="flex flex-col items-start gap-5 sm:flex-row {aside ? 'sm:flex-wrap lg:flex-nowrap' : ''}">
    <div data-entity-cover class="relative h-44 w-44 shrink-0 overflow-hidden bg-white/5 {round ? 'rounded-full' : 'rounded-2xl'}">
      {#if (loading || coverUrls.length) && !coverReady && !coverFailed}
        <div class="cherry-loading-skeleton absolute inset-0 bg-white/5" aria-hidden="true"></div>
      {/if}
      {#if coverUrls.length}
        <img use:artwork={{ urls: coverUrls, onfailure: () => (coverFailed = true) }} alt="" onload={() => { coverReady = true; coverFailed = false; }} class="absolute inset-0 h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none {coverReady ? 'opacity-100' : 'opacity-0'}" />
      {/if}
      {#if (!coverUrls.length && !loading) || coverFailed}
        <div class="flex h-full w-full items-center justify-center text-zinc-600"><i class="{fallbackIcon} text-5xl" aria-hidden="true"></i></div>
      {/if}
    </div>
    <div class="min-w-0 w-full sm:flex-1 sm:self-center">
    {#if loading}
      <div class="cherry-loading-skeleton flex w-full max-w-md flex-col gap-3" role="status" aria-label="Loading details">
        <div class="h-4 w-24 rounded-full bg-white/5"></div>
        <div class="h-9 w-3/4 rounded-lg bg-white/10"></div>
        <div class="h-3 w-36 rounded-full bg-white/5"></div>
        {#if actions}
          <div class="mt-1 flex gap-2"><div class="h-[42px] w-24 rounded-full bg-white/5"></div><div class="h-[42px] w-[42px] rounded-full bg-white/5"></div></div>
        {:else}
          <div class="h-3 w-full rounded-full bg-white/5"></div><div class="h-3 w-2/3 rounded-full bg-white/5"></div>
        {/if}
      </div>
    {:else}
      <div in:fade={{ duration: revealDuration }}>
        <slot />
      </div>
    {/if}
    </div>
    {#if aside && !loading}
      <div class="w-full shrink-0 lg:ml-auto lg:w-64 lg:self-center"><slot name="aside" /></div>
    {/if}
  </div>
</header>

<style>
  .entity-backdrop {
    mask-image: linear-gradient(to bottom, #000 var(--entity-fade-start, 15%), transparent var(--entity-fade-end, 85%));
  }
</style>
