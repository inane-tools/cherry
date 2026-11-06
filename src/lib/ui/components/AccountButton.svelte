<script lang="ts">
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/channelProfile';
  import { homeSectionsStore } from '$lib/app/services/playlists';
  import { go } from '$lib/app/services/navigation';
  import { isDesktop } from '$lib/app/services/platform';
  import { getCurrentWindow } from '$lib/desktop/window';
  import { releaseCodename } from '$lib/app/services/release';
  import AppMenu from './AppMenu.svelte';

  export let expanded = false;
  export let settingsIcon = false;
  let open = false;
  let anchor: HTMLButtonElement;
  $: profile = $activeChannelStore;
  $: name = profile?.name || $authStore?.accountLabel || 'Guest';
  $: initial = name.trim().charAt(0).toUpperCase() || 'G';
  $: target = $homeSectionsStore.find(section => section.header?.profile)?.header?.profile
    ?? (profile?.pageId?.startsWith('UC') ? { browseId: profile.pageId } : undefined);
  async function showProfile() {
    if (!target) return;
    const { openProfile } = await import('$lib/app/services/browse');
    openProfile(target, name, profile?.avatarUrl ? [{ url: profile.avatarUrl }] : []);
  }
</script>

<button bind:this={anchor} title={settingsIcon ? 'Main menu' : name} aria-label="Main menu" aria-haspopup="menu" aria-expanded={open}
  onclick={() => open = !open}
  class="group relative flex shrink-0 items-center {expanded ? 'w-full gap-2 rounded-2xl p-2 text-left transition-colors hover:bg-white/5' : settingsIcon ? 'cherry-nav-button h-8 w-8 justify-center rounded-full text-lg text-white transition-colors' : 'h-8 w-8 justify-center rounded-full bg-transparent'}">
  {#if settingsIcon}
    <i class="ph ph-gear-six" aria-hidden="true"></i>
  {:else}
  <span class="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[var(--color-avatar)]">
    {#if profile?.avatarUrl}
      <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
    {:else}
      <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-[11px] font-bold text-[#181818]">{initial}</span>
    {/if}
    {#if !expanded}<span class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"><i class="ph ph-list text-base" aria-hidden="true"></i></span>{/if}
  </span>
  {/if}
  {#if expanded}
    <span class="min-w-0 flex-1"><span class="block truncate text-[12px] font-semibold text-white">{name}</span>{#if profile?.handle}<span class="block truncate text-[10px] text-zinc-400">{profile.handle}</span>{/if}</span>
    <i class="ph ph-caret-down shrink-0 text-sm text-zinc-400" aria-hidden="true"></i>
  {/if}
</button>

{#if open}
  <AppMenu {anchor} label="Main menu" align={expanded ? 'left' : 'right'} branded footer={`v${__APP_VERSION__} · ${releaseCodename(__APP_VERSION__)}`}
    onclose={() => open = false}
    items={[
      { label: 'Settings', icon: 'ph ph-gear-six', action: () => go('settings') },
      { label: 'Your profile', icon: 'ph ph-user', avatar: profile?.avatarUrl, disabled: !target, action: showProfile },
      { label: 'Quit Cherry', icon: 'ph ph-sign-out', disabled: !isDesktop(), action: () => getCurrentWindow().close() },
    ]} />
{/if}
