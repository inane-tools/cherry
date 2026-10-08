<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { contextMenuStore, closeContextMenu } from '$lib/app/services/contextMenu';

  $: state = $contextMenuStore;

  // The menu is rendered at the cursor but clamped to the viewport so it never
  // runs off the edge. Measured after mount because the height depends on the
  // number of items.
  let el: HTMLDivElement | undefined;
  let x = 0;
  let y = 0;

  $: if (state.open) {
    x = state.x;
    y = state.y;
    queueMicrotask(clamp);
  }

  function clamp(): void {
    if (!el) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxX = window.innerWidth - w - margin;
    const maxY = window.innerHeight - h - margin;
    x = Math.max(margin, Math.min(x, maxX));
    y = Math.max(margin, Math.min(y, maxY));
  }

  function run(item: { disabled?: boolean; action: () => void | Promise<void> }): void {
    if (item.disabled) return;
    closeContextMenu();
    void item.action();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeContextMenu();
  }

  function onPointerDown(event: MouseEvent): void {
    if (!state.open) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-context-menu]')) return;
    closeContextMenu();
  }
</script>

<svelte:window onkeydown={onKey} onmousedown={onPointerDown} onresize={closeContextMenu} onscroll={closeContextMenu} />

{#if state.open}
  <div
    bind:this={el}
    data-context-menu
    class="fixed z-[60] min-w-[13rem] overflow-hidden rounded-lg border border-white/10 bg-[var(--color-elevated)]/98 py-1 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl"
    style="left: {x}px; top: {y}px;"
    role="menu"
    in:fly={{ y: -6, duration: 120 }}
    out:fade={{ duration: 90 }}
  >
    {#each state.items as item, i (i)}
      {#if item.separatorBefore && i > 0}
        <div class="my-1 h-px bg-white/5"></div>
      {/if}
      <button
        class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors {item.disabled
          ? 'cursor-default text-zinc-600'
          : 'text-zinc-200 hover:bg-white/5 hover:text-white'}"
        role="menuitem"
        onclick={() => run(item)}
      >
        <i class="{item.icon ?? 'bx bx-right-arrow-alt'} text-base {item.disabled ? '' : 'text-white'}"></i>
        <span class="truncate">{item.label}</span>
      </button>
    {/each}
  </div>
{/if}
