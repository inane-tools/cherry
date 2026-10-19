<script lang="ts" module>
  export interface AppMenuAction {
    label: string;
    icon: string;
    avatar?: string;
    disabled?: boolean;
    action: () => void | Promise<void>;
  }
</script>

<script lang="ts">
  import { fly } from '$lib/ui/transitions';
  import { artwork } from '$lib/ui/actions/artwork';
  import logoUrl from '$lib/assets/logo.png';
  import { overlayScrollbar, scrollbarOwner } from '$lib/ui/actions/overlayScrollbar';

  export let anchor: HTMLElement;
  export let items: AppMenuAction[] = [];
  export let label = 'Menu';
  export let footer = '';
  export let branded = false;
  export let align: 'left' | 'right' = 'right';
  export let onclose: () => void;
  let menu: HTMLDivElement;

  function close(restore = false) {
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    onclose();
  }

  function floating(node: HTMLDivElement) {
    (document.fullscreenElement ?? document.body).appendChild(node);
    function position() {
      if (!anchor.isConnected) { close(); return; }
      const bounds = anchor.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = document.documentElement.clientHeight || window.innerHeight;
      const above = bounds.top - 14;
      const below = height - bounds.bottom - 14;
      const upwards = node.scrollHeight > below && above > below;
      node.style.setProperty('--menu-origin', `${align === 'right' ? '100%' : '0%'} ${upwards ? '100%' : '0%'}`);
      node.style.setProperty('--menu-direction', upwards ? '-1' : '1');
      node.style.maxHeight = `${Math.max(0, upwards ? above : below)}px`;
      const rect = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(align === 'right' ? bounds.right - rect.width : bounds.left, width - rect.width - 8))}px`;
      node.style.top = `${upwards ? Math.max(8, bounds.top - rect.height - 6) : bounds.bottom + 6}px`;
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!node.contains(target) && !anchor.contains(target) && scrollbarOwner(target) !== node) close();
    }
    function scroll(event: Event) {
      if (!node.contains(event.target as Node)) close();
    }
    function other(event: Event) {
      if ((event as CustomEvent).detail !== node) close();
    }
    window.dispatchEvent(new CustomEvent('cherry:app-menu', { detail: node }));
    window.addEventListener('cherry:app-menu', other);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    const observer = new ResizeObserver(position);
    observer.observe(node); observer.observe(anchor);
    position();
    queueMicrotask(() => {
      if (node.isConnected) node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return { destroy() {
      observer.disconnect();
      window.removeEventListener('cherry:app-menu', other);
      window.removeEventListener('resize', position);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      node.remove();
    } };
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Tab') { close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }
</script>

<div bind:this={menu} use:floating use:overlayScrollbar role="menu" aria-label={label}
  onkeydown={key} tabindex="-1" data-app-menu
  class="cherry-overlay-scroll fixed z-[90] w-56 max-w-[calc(100vw-1rem)] rounded-2xl bg-[var(--color-elevated)] p-1.5 text-zinc-200 shadow-[0_12px_36px_rgba(0,0,0,0.3)] outline-none"
  style="-webkit-app-region: no-drag"
  in:fly={{ y: -6, duration: 180 }} out:fly={{ y: -3, duration: 100 }}>
  {#each items as item}
    <button role="menuitem" disabled={item.disabled}
      class="flex min-h-10 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/5 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none disabled:cursor-default disabled:text-zinc-600"
      onclick={() => { close(true); void item.action(); }}>
      <span class="relative flex h-5 w-5 shrink-0 items-center justify-center text-xl leading-none" aria-hidden="true">
        <i class={item.icon}></i>
        {#if item.avatar}<img use:artwork={{ urls: [item.avatar] }} alt="" draggable="false" class="absolute inset-0 h-5 w-5 rounded-full bg-[var(--color-avatar)] object-cover" />{/if}
      </span>
      <span class="min-w-0 -translate-y-px truncate leading-5">{item.label}</span>
    </button>
  {/each}
  {#if footer}
    <div class="mx-2.5 mt-1 flex items-center gap-2 border-t border-white/10 pb-1 pt-2 text-[11px] text-zinc-500">
      {#if branded}<img src={logoUrl} alt="Cherry" draggable="false" class="h-5 w-5 shrink-0" />{/if}
      <span class="min-w-0 flex-1 truncate text-right">{footer}</span>
    </div>
  {/if}
</div>
