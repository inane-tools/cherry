<script lang="ts">
  import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
  import { thumbnailSources } from '$lib/core/models';
  import { artwork } from '$lib/ui/actions/artwork';
  import { openBrowseCard, openProfile } from '$lib/app/services/browse';
  import { isPrivateProfileSection, profileSectionTitle } from '$lib/core/profileSections';

  export let section: HomeSection;
  export let profilePage = false;
  export let large = false;
  export let reserveArrows = true;
  $: header = section.header;
  $: profile = header?.profile;
  $: more = header?.more;
  $: privateSection = profilePage && isPrivateProfileSection(section);
  $: publicSection = profilePage && !privateSection && (/^public\b/i.test(section.title) || /\bpublic\b/i.test(header?.subtitle ?? ''));
  $: visibility = privateSection ? 'Private' : publicSection ? 'Public' : '';
  $: title = publicSection
    ? profileSectionTitle(section).replace(/^public\s+(playlists|videos)$/i, (_, kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1))
    : profilePage ? profileSectionTitle(section) : section.title;
  $: urls = thumbnailSources(header?.thumbnails ?? [], 96);
  function openOwner() {
    if (profile) openProfile(profile, header?.subtitle ?? 'Profile', header?.thumbnails);
  }
  function openMore() {
    if (more && profilePage && more.browseId.startsWith('UC')) openProfile(more, section.title);
    else if (more) openBrowseCard(more.browseId, section.title, [], undefined, more.params, more.pageType);
  }
</script>

<div class="mb-3 flex min-h-8 items-center gap-3 {reserveArrows ? 'pr-24' : ''}">
  {#if urls.length}
    {#if profile}
      <button class="h-9 w-9 shrink-0 overflow-hidden rounded-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        aria-label={`Open ${header?.subtitle || 'user'} profile`} onclick={openOwner}>
        <img use:artwork={{ urls }} alt="" class="h-full w-full object-cover" />
      </button>
    {:else}
      <img use:artwork={{ urls }} alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
    {/if}
  {/if}
  <div class="min-w-0">
    {#if visibility}
      <span class="mb-1 block w-fit rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold leading-4 text-zinc-300">{visibility}</span>
    {:else if header?.subtitle && !profile}<div class="mb-0.5 truncate text-[11px] font-medium text-zinc-400">{header.subtitle}</div>{/if}
    <h2 class="min-w-0 tracking-tight text-white {large ? 'text-[26px] font-extrabold leading-tight sm:text-[32px]' : 'text-[17px] font-bold sm:text-[19px]'}">
      {#if more}
        <button class="flex max-w-full items-center gap-1.5 text-left hover:text-zinc-300" onclick={openMore}>
          <span class="truncate">{title || 'For you'}</span><i class="ph ph-caret-right shrink-0 text-base" aria-hidden="true"></i>
        </button>
      {:else}{title || 'For you'}{/if}
    </h2>
  </div>
</div>
