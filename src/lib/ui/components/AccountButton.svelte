<script lang="ts">
  import { tick } from 'svelte';
  import { authStore } from '$lib/app/services/auth';
  import { activeChannelStore } from '$lib/app/services/channelProfile';
  import { homeSectionsStore } from '$lib/app/services/playlists';
  import { go } from '$lib/app/services/navigation';
  import { isDesktop } from '$lib/app/services/platform';
  import { updateStore } from '$lib/app/services/updates';
  import { getCurrentWindow } from '$lib/desktop/window';
  import { releaseCodename } from '$lib/app/services/release';
  import AppMenu, { type AppMenuAction } from './AppMenu.svelte';

  /** Full-width row with account details (expanded sidebar); otherwise just
   *  the avatar (compact sidebar). */
  export let expanded = false;
  let open = false;
  let anchor: HTMLButtonElement;
  $: profile = $activeChannelStore;
  $: name = profile?.name || $authStore?.accountLabel || 'Guest';
  $: initial = name.trim().charAt(0).toUpperCase() || 'G';
  $: target = $homeSectionsStore.find(section => section.header?.profile)?.header?.profile
    ?? (profile?.pageId?.startsWith('UC') ? { browseId: profile.pageId } : undefined);
  // Updates are announced here (the avatar badge and the first menu item)
  // rather than in the top bar.
  $: update = $updateStore.phase === 'available' || $updateStore.phase === 'ready' ? $updateStore : null;
  $: updateLabel = update ? `Update ${update.phase === 'ready' ? 'ready' : 'available'} · v${update.version}` : '';
  $: items = [
    ...(update ? [{ label: updateLabel, icon: 'ph-fill ph-arrow-circle-up text-amber-400', action: showUpdates }] : []),
    { label: 'Settings', icon: 'ph ph-gear-six', action: () => go('settings') },
    { label: 'Your profile', icon: 'ph ph-user', avatar: profile?.avatarUrl, disabled: !target, action: showProfile },
    { label: 'Quit Cherry', icon: 'ph ph-sign-out', disabled: !isDesktop(), action: () => getCurrentWindow().close() },
  ] satisfies AppMenuAction[];

  async function showProfile() {
    if (!target) return;
    const { openProfile } = await import('$lib/app/services/browse');
    openProfile(target, name, profile?.avatarUrl ? [{ url: profile.avatarUrl }] : []);
  }

  async function showUpdates() {
    go('settings');
    await tick();
    document.getElementById('cherry-updates')?.scrollIntoView({ block: 'center' });
  }
</script>

{#snippet avatar(size: string)}
  <span class="relative flex {size} shrink-0">
    <span class="flex h-full w-full overflow-hidden rounded-full bg-[var(--color-avatar)] {update ? 'ring-2 ring-amber-400' : 'ring-white/20 transition-shadow group-hover:ring-2'}">
      {#if profile?.avatarUrl}
        <img src={profile.avatarUrl} alt="" class="h-full w-full object-cover" />
      {:else}
        <span class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] text-[11px] font-bold text-[#181818]">{initial}</span>
      {/if}
    </span>
    {#if update}
      <span class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] leading-none text-[#181818] ring-2 ring-[var(--color-popover)]" aria-hidden="true">
        <i class="ph-fill ph-arrow-up block leading-none"></i>
      </span>
    {/if}
  </span>
{/snippet}

<button bind:this={anchor} title={update ? `${name} · ${updateLabel}` : name} aria-label={update ? `Main menu, ${updateLabel}` : 'Main menu'} aria-haspopup="menu" aria-expanded={open}
  onclick={() => open = !open}
  class="group relative flex shrink-0 items-center {expanded
    ? 'w-full gap-3 rounded-xl p-1 text-left transition-colors hover:bg-white/5'
    : 'h-10 w-10 justify-center rounded-full'}">
  {#if expanded}
    {@render avatar('h-9 w-9')}
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[12px] font-semibold text-white">{name}</span>
      {#if profile?.handle}<span class="block truncate text-[10px] text-zinc-400">{profile.handle}</span>{/if}
    </span>
    <i class="ph ph-caret-up shrink-0 text-sm text-zinc-500" aria-hidden="true"></i>
  {:else}
    {@render avatar('h-9 w-9')}
  {/if}
</button>

{#if open}
  <AppMenu {anchor} label="Main menu" align="left" branded footer={`v${__APP_VERSION__} · ${releaseCodename(__APP_VERSION__)}`}
    onclose={() => open = false}
    {items} />
{/if}
