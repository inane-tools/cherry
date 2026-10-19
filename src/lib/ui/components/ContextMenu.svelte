<script lang="ts">
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { artwork } from '$lib/ui/actions/artwork';
  import { thumbnailSources } from '$lib/core/models';
  import { menuReveal } from '$lib/ui/transitions';
  import { contextMenuStore, closeContextMenu, type ContextMenuItem } from '$lib/app/services/contextMenu';

  $: state = $contextMenuStore;
  $: shortcuts = state.items.length > 6 ? state.items.filter(item => item.quick).slice(0, 5) : [];
  $: rows = state.items.filter(item => !shortcuts.includes(item));
  let shortcutsBelow = false;

  // The menu is rendered at the cursor but clamped to the viewport so it never
  // runs off the edge. Measured after mount because the height depends on the
  // number of items.
  let el: HTMLDivElement | undefined;
  let x = 0;
  let y = 0;

  function menuHost(node: HTMLElement) {
    const previousFocus = document.activeElement;
    (document.fullscreenElement ?? document.body).appendChild(node);
    clamp(node);
    queueMicrotask(() => { clamp(); node.focus({ preventScroll: true }); });
    return { destroy() {
      const restoreFocus = node.contains(document.activeElement);
      node.remove();
      if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    } };
  }

  $: if (state.open) {
    x = state.x;
    y = state.y;
    queueMicrotask(clamp);
  }

  function clamp(node: HTMLElement | undefined = el): void {
    if (!node) return;
    const margin = 8;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const maxX = window.innerWidth - w - margin;
    const maxY = window.innerHeight - h - margin;
    x = Math.max(margin, Math.min(x, maxX));
    y = Math.max(margin, Math.min(state.y + h > window.innerHeight - margin ? state.y - h : state.y, maxY));
    shortcutsBelow = state.y > y + h / 2;
    const originX = w ? Math.max(0, Math.min(100, (state.x - x) / w * 100)) : 50;
    node.style.setProperty('--menu-origin', `${originX}% ${shortcutsBelow ? '100%' : '0%'}`);
    node.style.setProperty('--menu-direction', shortcutsBelow ? '-1' : '1');
  }

  function run(item: { disabled?: boolean; action: () => void | Promise<void> }): void {
    if (item.disabled) return;
    closeContextMenu();
    void item.action();
  }

  function onKey(event: KeyboardEvent): void {
    if (!state.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(); }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (shortcutsBelow) buttons.sort((a, b) => Number(a.closest('[data-shortcuts]') !== null) - Number(b.closest('[data-shortcuts]') !== null));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : at < 0 ? (backwards ? buttons.length - 1 : 0) : (at + (backwards ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function onPointerDown(event: MouseEvent): void {
    if (!state.open) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-context-menu]')) return;
    closeContextMenu();
  }
</script>

{#snippet icon(item: ContextMenuItem)}
  <span class="relative flex h-5 w-5 shrink-0 items-center justify-center text-[18px] leading-none" aria-hidden="true">
    {#if item.playlistArtwork}
      <span class="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded bg-white/5">
        <i class="ph ph-playlist text-base" aria-hidden="true"></i>
        {#if item.playlistArtwork.length}
          <img use:artwork={{ urls: thumbnailSources(item.playlistArtwork, 64) }} alt="" draggable="false" class="absolute inset-0 h-full w-full object-cover" />
        {/if}
      </span>
      <span class="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--color-accent)] text-[#fff]">
        <i class="ph ph-plus text-[10px]" aria-hidden="true"></i>
      </span>
    {:else if item.customIcon === 'mix'}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 4a11 11 0 0 0 0 16M8 7a7 7 0 0 0 0 10M19 4a11 11 0 0 1 0 16M16 7a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        <path d="m10 8 6 4-6 4V8Z" fill="currentColor" />
      </svg>
    {:else if item.brandIcon === 'youtube-music'}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm0 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-15a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm-2 3 6 4-6 4V8Z" /></svg>
    {:else}
      <i class={item.icon ?? 'ph ph-arrow-right'} aria-hidden="true"></i>
    {/if}
  </span>
{/snippet}

<svelte:window onkeydown={onKey} onmousedown={onPointerDown} onresize={closeContextMenu} onscroll={closeContextMenu} />

{#if state.open}
  <div
    bind:this={el}
    use:menuHost
    use:overlayScrollbar
    data-context-menu
    class="cherry-overlay-scroll fixed z-[60] flex max-h-[calc(100vh-1rem)] min-w-[13rem] max-w-[calc(100vw-1rem)] flex-col rounded-xl bg-[var(--color-elevated)]/98 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none"
    style="left: {x}px; top: {y}px;"
    role="menu"
    tabindex="-1"
    in:menuReveal
    out:menuReveal={{ duration: 100, distance: 2, scale: 0.99 }}
  >
    {#if shortcuts.length}
      <div data-shortcuts class="sticky z-10 flex shrink-0 items-center gap-1 bg-[var(--color-elevated)] p-1 {shortcutsBelow ? 'bottom-0 order-last mt-1 border-t border-white/10 pt-2' : 'top-0 mb-1 border-b border-white/10 pb-2'}">
        {#each shortcuts as item}
          <button class="cherry-nav-button flex h-9 min-w-9 flex-1 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:text-white focus-visible:bg-white/10 disabled:cursor-default disabled:opacity-40"
            role="menuitem" disabled={item.disabled} title={item.label} aria-label={item.label} onclick={() => run(item)}>
            {@render icon(item)}
          </button>
        {/each}
      </div>
    {/if}
    {#each rows as item, i (i)}
      {#if item.separatorBefore && i > 0}
        <div role="separator" class="mx-2 my-1 h-px shrink-0 bg-white/10"></div>
      {/if}
      <button
        class="flex min-h-9 w-full shrink-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[12px] leading-4 transition-colors focus-visible:bg-white/10 {item.disabled
          ? 'cursor-default text-zinc-600'
          : item.destructive ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300' : 'text-zinc-200 hover:bg-white/5 hover:text-white'}"
        role="menuitem"
        disabled={item.disabled}
        onclick={() => run(item)}
      >
        {@render icon(item)}
        <span class="min-w-0 -translate-y-px truncate leading-5">{item.label}</span>
      </button>
    {/each}
  </div>
{/if}
