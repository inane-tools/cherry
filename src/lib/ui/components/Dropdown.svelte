<script lang="ts">
  import { fade, fly } from '$lib/ui/transitions';

  /** A flat, borderless select. Values are strings; callers parse as needed. */
  export let value = '';
  export let options: { value: string; label: string }[] = [];
  export let onchange: (value: string) => void = () => {};
  export let ariaLabel = '';
  /** Extra classes for the trigger (e.g. a max-width). */
  export let buttonClass = '';

  let open = false;
  let root: HTMLDivElement | undefined;
  let menu: HTMLDivElement | undefined;

  $: current = options.find((option) => option.value === value)?.label ?? '';

  function pick(next: string): void {
    open = false;
    if (next !== value) onchange(next);
  }

  function onWindowClick(event: MouseEvent): void {
    if (!open) return;
    const target = event.target as Node;
    if (root && !root.contains(target) && !menu?.contains(target)) open = false;
  }

  // Render outside the section's animated clipping container and the overlay's
  // scroll viewport. Coordinates use CSS pixels, including native webview zoom.
  function floatingMenu(node: HTMLDivElement) {
    menu = node;
    document.body.appendChild(node);

    function position(): void {
      if (!root) return;
      const anchor = root.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      node.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
      node.style.minWidth = `${Math.min(anchor.width, viewportWidth - margin * 2)}px`;
      const below = Math.max(0, viewportHeight - anchor.bottom - gap - margin);
      const above = Math.max(0, anchor.top - gap - margin);
      const upwards = node.scrollHeight > below && above > below;
      node.style.maxHeight = `${upwards ? above : below}px`;
      const bounds = node.getBoundingClientRect();
      node.style.left = `${Math.max(margin, Math.min(anchor.right - bounds.width, viewportWidth - bounds.width - margin))}px`;
      node.style.top = `${upwards ? anchor.top - gap - bounds.height : anchor.bottom + gap}px`;
    }

    function onScroll(event: Event): void {
      // Keep scrolling inside a long menu usable; close when its anchor moves.
      if (!node.contains(event.target as Node)) open = false;
    }

    position();
    const observer = new ResizeObserver(position);
    observer.observe(node);
    if (root) observer.observe(root);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    // Capture also sees clicks inside Settings, whose dialog stops bubbling.
    document.addEventListener('click', onWindowClick, true);

    return {
      destroy() {
        observer.disconnect();
        window.removeEventListener('resize', position);
        document.removeEventListener('scroll', onScroll, true);
        document.removeEventListener('click', onWindowClick, true);
        menu = undefined;
        node.remove();
      },
    };
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={onKey} />

<div bind:this={root} class="relative inline-block max-w-full">
  <button
    type="button"
    class="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg bg-white/[0.04] pl-2.5 pr-1.5 text-[11px] text-zinc-200 outline-none transition-colors hover:bg-white/[0.07] {open
      ? 'bg-white/[0.07]'
      : ''} {buttonClass}"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={() => (open = !open)}
  >
    <span class="truncate">{current}</span>
    <i
      class="bx bx-chevron-down shrink-0 text-base text-zinc-500 transition-transform {open
        ? 'rotate-180'
        : ''}"
      aria-hidden="true"
    ></i>
  </button>

  {#if open}
    <div
      use:floatingMenu
      class="fixed z-[60] overflow-y-auto rounded-xl bg-[var(--color-elevated)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      role="listbox"
      in:fly={{ y: -4, duration: 120 }}
      out:fade={{ duration: 90 }}
    >
      {#each options as option (option.value)}
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          class="flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors {option.value ===
          value
            ? 'text-white'
            : 'text-zinc-300 hover:bg-white/5 hover:text-white'}"
          onclick={() => pick(option.value)}
        >
          <span class="truncate">{option.label}</span>
          {#if option.value === value}
            <i class="bx bx-check shrink-0 text-base text-[var(--color-accent2)]"></i>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
