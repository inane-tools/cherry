<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { pageVisitStore, readPageView, savePageView } from '$lib/app/services/pageVisit';
  import { pageStore } from '$lib/app/services/navigation';
  import { authStore } from '$lib/app/services/auth';
  import { getActiveChannel, getBrowsePage } from '$lib/infra/ytmusic/InnertubeClient';
  import { authIdentity } from '$lib/infra/ytmusic/authContext';
  import { activeChannelStore } from '$lib/app/services/account';
  import type { HomeSection, PageHeader, PageAction, BrowseTarget } from '$lib/infra/ytmusic/rawHome';
  import { entriesOf, selectCarouselEntry, playCarouselEntry, openCarouselMenu, openBrowseCard } from '$lib/app/services/browse';
  import ShelfSkeleton from '$lib/ui/components/ShelfSkeleton.svelte';
  import { fade } from '$lib/ui/transitions';
  import EntityHeader from '$lib/ui/components/EntityHeader.svelte';
  import { playRadio } from '$lib/app/services/radio';
  import { copyText } from '$lib/app/services/links';
  import { notify } from '$lib/app/services/contextMenu';
  import Carousel from '$lib/ui/components/Carousel.svelte';
  import ShelfHeading from '$lib/ui/components/ShelfHeading.svelte';
  import { thumbnailSources } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import { appendProfileSection, isPersonalMix, profileSectionTitle, repeatListening } from '$lib/core/profileSections';
  import { repeatListeningStore } from '$lib/app/services/profilePersonalization';
  import { appendBrowseSections, browsePresentation } from '$lib/core/browseLayout';

  let sections: HomeSection[] = [];
  let header: PageHeader | null = null;
  let actionBusy = false;
  let continuation: string | null = null;
  let loading = false;
  let error = '';
  let sequence = 0;
  let loadedKey = '';
  const tokens = new Set<string>();
  type ShelfState = { busy: boolean; error: string; done: boolean; next?: string; target: BrowseTarget; tokens: Set<string> };
  let shelfStates: Record<number, ShelfState> = {};
  let shelfGeneration = 0;
  const visit = get(pageVisitStore);
  const exploreView = $pageStore.view === 'explore';
  type ExploreSnapshot = { key: string; sections: HomeSection[]; header: PageHeader | null; continuation: string | null; tokens: string[] };
  let savedExplore = exploreView && visit.restore ? readPageView<ExploreSnapshot>(visit.token) : undefined;
  $: page = $pageStore.view === 'explore' ? { browseId: 'FEmusic_explore', title: 'Explore', params: undefined } : $pageStore.view === 'browse' ? $pageStore.entity : null;
  $: isProfile = $pageStore.view === 'browse' && $pageStore.entity.kind === 'profile';
  $: isSubpage = $pageStore.view === 'browse' && !isProfile;
  $: profileArtwork = header?.thumbnails?.length ? header.thumbnails : ($pageStore.view === 'browse' ? $pageStore.entity.thumbnails ?? [] : []);
  $: mixSection = isProfile ? sections.find(isPersonalMix) : undefined;
  $: mixEntry = mixSection ? entriesOf(mixSection)[0] : undefined;
  $: mixAction = isProfile ? header?.actions?.find(action => /personal mix/i.test(action.label)) : undefined;
  $: hasMix = !!mixEntry || !!mixAction;
  $: mixArtwork = thumbnailSources(mixEntry?.thumbnails?.length ? mixEntry.thumbnails : profileArtwork, 320);
  $: profileActions = (header?.actions ?? []).filter(action => !hasMix || action !== mixAction);
  $: key = `${page?.browseId}:${page?.params ?? ''}:${authIdentity($authStore)}:${$activeChannelStore?.pageId ?? ''}`;
  $: if (page && key !== loadedKey) {
    loadedKey = key;
    if (savedExplore?.key === key) {
      sections = savedExplore.sections; header = savedExplore.header; continuation = savedExplore.continuation;
      for (const token of savedExplore.tokens) tokens.add(token);
      savedExplore = undefined;
    } else void load(false);
  }
  onDestroy(() => {
    if (exploreView && sections.length) savePageView<ExploreSnapshot>(visit.token, { key: loadedKey, sections, header, continuation, tokens: [...tokens] });
    sequence++; shelfGeneration++;
  });

  async function load(more: boolean): Promise<void> {
    if (!page || (more && loading)) return;
    const id = ++sequence;
    const target = page;
    const session = $authStore;
    const channel = getActiveChannel();
    const stale = () => id !== sequence || authIdentity($authStore) !== authIdentity(session) || getActiveChannel() !== channel;
    const token = more ? continuation : null;
    if (more && (!token || tokens.has(token))) return;
    loading = true;
    error = '';
    if (!more) { sections = []; header = null; continuation = null; tokens.clear(); shelfStates = {}; shelfGeneration++; }
    try {
      const result = await getBrowsePage(target.browseId, session, target.params, token ?? undefined);
      if (stale()) return;
      if (!more) {
        header = result.header ?? null;
        if (isProfile && header) {
          const info = header;
          pageStore.update(current => current.view === 'browse' && current.entity.browseId === target.browseId && current.entity.params === target.params
            ? { ...current, entity: { ...current.entity, title: info.title || current.entity.title, ...(info.thumbnails.length ? { thumbnails: info.thumbnails } : {}) } } : current);
        }
      }
      if (token) tokens.add(token);
      sections = more ? isSubpage ? appendBrowseSections(sections, result.sections) : [...sections, ...result.sections] : result.sections;
      // Repeat shelves are private responses from the signed-in profile, never
      // inferred from another profile's public playlists or artist names.
      if (isProfile) {
        const listening = repeatListening(sections);
        if (Object.values(listening).some(items => items.length)) repeatListeningStore.set(listening);
      }
      continuation = result.continuation && !tokens.has(result.continuation) && tokens.size < 20 ? result.continuation : null;
    } catch { if (!stale()) error = 'Could not load this page. Try again.'; }
    finally { if (id === sequence) loading = false; }
  }

  async function loadShelf(index: number): Promise<void> {
    const section = sections[index];
    if ((!isProfile && !isSubpage) || !page || !section || shelfStates[index]?.busy || shelfStates[index]?.done) return;
    const state = shelfStates[index] ?? {
      busy: false, error: '', done: false, next: section.continuation,
      target: section.continuation ? { browseId: page.browseId, params: page.params } : section.header?.more ?? { browseId: page.browseId, params: page.params },
      tokens: new Set<string>(),
    };
    const token = state.next;
    const epoch = shelfGeneration;
    const session = $authStore;
    const channel = getActiveChannel();
    const stale = () => epoch !== shelfGeneration || authIdentity($authStore) !== authIdentity(session) || getActiveChannel() !== channel;
    shelfStates = { ...shelfStates, [index]: { ...state, busy: true, error: '' } };
    try {
      const result = await getBrowsePage(state.target.browseId, session, state.target.params, token);
      if (stale()) return;
      // A More endpoint may include several shelves. Append only this shelf,
      // or the unlabelled/single grid returned by its continuation.
      const matching = result.sections.filter(item => !item.title || profileSectionTitle(item) === profileSectionTitle(section));
      const additions = matching.length ? matching : result.sections.length === 1 ? result.sections : [];
      if (!additions.length && result.sections.length) throw new Error('Unexpected section response');
      const seen = new Set(state.tokens);
      if (token) seen.add(token);
      const next = result.continuation ?? (additions.length === 1 ? additions[0].continuation : undefined);
      sections = sections.map((item, i) => i === index ? appendProfileSection(item, additions) : item);
      shelfStates = { ...shelfStates, [index]: { ...state, busy: false, error: '', tokens: seen,
        next: next ?? undefined, done: !next || seen.has(next) || seen.size >= 200 } };
      if (isProfile) {
        const listening = repeatListening(sections);
        if (Object.values(listening).some(items => items.length)) repeatListeningStore.set(listening);
      }
    } catch {
      if (!stale()) shelfStates = { ...shelfStates, [index]: { ...state, busy: false, error: 'Could not load more items. Try again.' } };
    }
  }

  async function runAction(action: PageAction) {
    if (!page || actionBusy) return;
    actionBusy = true;
    try {
      if (action.playback) await playRadio(action.playback);
      else if (action.browse) openBrowseCard(action.browse.browseId, action.label, [], undefined, action.browse.params, action.browse.pageType);
      else if (action.share) notify(await copyText(`https://music.youtube.com/channel/${encodeURIComponent(page.browseId)}`) ? 'Profile link copied' : 'Could not copy profile link');
    } catch { notify('Could not open this profile action. Try again.'); }
    finally { actionBusy = false; }
  }

  async function playPersonalMix() {
    if (actionBusy) return;
    if (mixEntry && mixSection) {
      actionBusy = true;
      try { await selectCarouselEntry(mixSection, mixEntry); }
      catch { notify('Could not play your personal mix. Try again.'); }
      finally { actionBusy = false; }
    } else if (mixAction) await runAction(mixAction);
  }
</script>

<div class="mx-auto pb-6 {isProfile ? 'max-w-[80rem] pt-6' : 'max-w-[100rem]'}">
  {#if isProfile}
    <EntityHeader thumbnails={profileArtwork} banner={header?.banner ?? []} condensed loading={loading && !header} aside={hasMix} round fallbackIcon="ph-duotone ph-user">
        <div class="min-w-0">
          <div class="w-fit rounded-full bg-white/[0.06] px-3 py-0.5 text-[10px] font-semibold text-zinc-300">Profile</div>
          <h1 class="mt-2 line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">{header?.title || page?.title || 'Profile'}</h1>
          {#if header?.subtitle}<p class="mt-1.5 text-[12px] text-zinc-400">{header.subtitle}</p>{/if}
          {#if header?.description}<p class="mt-3 line-clamp-3 max-w-3xl whitespace-pre-line text-[12px] leading-relaxed text-zinc-400" title={header.description}>{header.description}</p>{/if}
          {#if profileActions.length}
            <div class="mt-4 flex flex-wrap gap-2">
              {#each profileActions as action}
                <button class="cherry-nav-button flex h-[42px] items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white transition-colors disabled:cursor-default disabled:opacity-40"
                  disabled={actionBusy} onclick={() => runAction(action)}>
                  <i class="{action.playback ? 'ph-fill ph-play' : action.share ? 'ph ph-share-network' : 'ph ph-arrow-right'} text-xl leading-none" aria-hidden="true"></i>{action.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <svelte:fragment slot="aside">
          <button class="cherry-nav-button group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors disabled:opacity-40" disabled={actionBusy} onclick={playPersonalMix} aria-label="Play personal mix">
            <span class="relative block aspect-square w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
              {#if mixArtwork.length}<img use:artwork={{ urls: mixArtwork }} alt="" class="h-full w-full object-cover" />{/if}
              <span class="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><i class="ph-fill ph-play text-3xl" aria-hidden="true"></i></span>
            </span>
            <span class="min-w-0"><span class="block text-[13px] font-semibold text-white">Personal mix</span><span class="mt-1 block text-[10px] text-zinc-400">Made for you · Private</span></span>
          </button>
        </svelte:fragment>
    </EntityHeader>
  {:else}
    <h1 class="my-6 text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">{page?.title ?? 'Browse'}</h1>
  {/if}
  {#if loading && !sections.length}
    <ShelfSkeleton grid={isSubpage} />
  {:else}
  <div in:fade={{ duration: 160 }}>
  {#each sections as section, index}
    {@const presentation = isSubpage ? browsePresentation(section) : 'carousel'}
    {@const canLoadMore = (isProfile || isSubpage) && (shelfStates[index] ? !shelfStates[index].done : !!(section.continuation || section.header?.more))}
    {#if !(isProfile && isPersonalMix(section) && hasMix) && (isProfile || isSubpage || !/listen together|station/i.test(section.title)) && entriesOf(section).length}
      <section class="mb-9">
        {#if !isSubpage || (section.title && section.title.toLowerCase() !== page?.title.toLowerCase())}
          <ShelfHeading {section} profilePage={isProfile} reserveArrows={presentation === 'carousel'} />
        {/if}
        <Carousel scrollKey={`browse:${section.title}:${index}`} entries={entriesOf(section)} {presentation} layout={section.layout ?? 'cards'} rows={section.rows ?? 3} onSelect={(entry) => selectCarouselEntry(section, entry)} onPlay={(entry) => playCarouselEntry(section, entry)} onContextMenu={(event, entry) => openCarouselMenu(section, entry, event)}
          onLoadMore={canLoadMore ? () => loadShelf(index) : undefined}
          loadingMore={shelfStates[index]?.busy ?? false} />
        {#if canLoadMore && presentation !== 'carousel'}
          <button class="cherry-nav-button mt-5 rounded-full px-5 py-2 text-[12px] text-zinc-200 disabled:opacity-40" disabled={shelfStates[index]?.busy} aria-label={`Load more ${section.title || page?.title || 'items'}`} onclick={() => loadShelf(index)}>{shelfStates[index]?.busy ? 'Loading…' : shelfStates[index]?.error ? 'Try again' : 'More'}</button>
        {/if}
        {#if shelfStates[index]?.error}<p role="alert" class="mt-2 text-[12px] text-zinc-400">{shelfStates[index].error}</p>{/if}
      </section>
    {/if}
  {/each}
  </div>
  {/if}
  {#if error}<p role="alert" class="text-[13px] text-zinc-400">{error}</p>{/if}
  {#if loading && sections.length}<p role="status" class="py-6 text-[13px] text-zinc-500">Loading more…</p>
  {:else if !loading && (continuation || error)}<button class="rounded-full bg-white/5 px-5 py-2 text-[12px] text-zinc-200 hover:bg-white/10" onclick={() => load(!!continuation)}>{error ? 'Try again' : isProfile || isSubpage ? 'More' : 'More recommendations'}</button>
  {:else if !loading && !sections.length}<p class="text-[13px] text-zinc-400">{isProfile ? 'Nothing to show on this profile.' : 'No recommendations available here.'}</p>{/if}
</div>
