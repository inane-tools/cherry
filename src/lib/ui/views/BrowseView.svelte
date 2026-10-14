<script lang="ts">
  import { onDestroy } from 'svelte';
  import { pageStore } from '$lib/app/services/navigation';
  import { authStore } from '$lib/app/services/auth';
  import { getBrowsePage } from '$lib/infra/ytmusic/InnertubeClient';
  import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
  import { entriesOf, selectCarouselEntry, playCarouselEntry } from '$lib/app/services/browse';
  import Carousel from '$lib/ui/components/Carousel.svelte';

  let sections: HomeSection[] = [];
  let continuation: string | null = null;
  let loading = false;
  let error = '';
  let sequence = 0;
  let loadedKey = '';
  const tokens = new Set<string>();
  $: page = $pageStore.view === 'explore' ? { browseId: 'FEmusic_explore', title: 'Explore', params: undefined } : $pageStore.view === 'browse' ? $pageStore.entity : null;
  $: key = `${page?.browseId}:${page?.params ?? ''}:${$authStore?.cookie ?? ''}`;
  $: if (page && key !== loadedKey) { loadedKey = key; void load(false); }
  onDestroy(() => { sequence++; });

  async function load(more: boolean): Promise<void> {
    if (!page) return;
    const id = ++sequence;
    const target = page;
    const token = more ? continuation : null;
    if (more && (!token || tokens.has(token))) return;
    loading = true;
    error = '';
    if (!more) { sections = []; continuation = null; tokens.clear(); }
    try {
      const result = await getBrowsePage(target.browseId, $authStore, target.params, token ?? undefined);
      if (id !== sequence) return;
      if (token) tokens.add(token);
      sections = more ? [...sections, ...result.sections] : result.sections;
      continuation = result.continuation && !tokens.has(result.continuation) && tokens.size < 20 ? result.continuation : null;
    } catch { if (id === sequence) error = 'Could not load this page. Try again.'; }
    finally { if (id === sequence) loading = false; }
  }
</script>

<div class="mx-auto max-w-[100rem] pb-6">
  <h1 class="my-6 text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">{page?.title ?? 'Browse'}</h1>
  {#each sections as section}
    {#if !/listen together|station/i.test(section.title) && entriesOf(section).length}
      <section class="mb-9">
        <h2 class="mb-3 pr-24 text-[19px] font-bold text-white">{section.title || 'For you'}</h2>
        <Carousel entries={entriesOf(section)} layout={section.layout ?? 'cards'} rows={section.rows ?? 3} onSelect={(entry) => selectCarouselEntry(section, entry)} onPlay={(entry) => playCarouselEntry(section, entry)} />
      </section>
    {/if}
  {/each}
  {#if error}<p role="alert" class="text-[13px] text-zinc-400">{error}</p>{/if}
  {#if loading}<p class="py-6 text-[13px] text-zinc-500">Loading…</p>
  {:else if continuation || error}<button class="rounded-full bg-white/5 px-5 py-2 text-[12px] text-zinc-200 hover:bg-white/10" onclick={() => load(!!continuation)}>{error ? 'Try again' : 'More recommendations'}</button>
  {:else if !sections.length}<p class="text-[13px] text-zinc-400">No recommendations available here.</p>{/if}
</div>
