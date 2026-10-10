<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  /** A flat, borderless select. Values are strings; callers parse as needed. */
  export let value = '';
  export let options: { value: string; label: string }[] = [];
  export let onchange: (value: string) => void = () => {};
  export let ariaLabel = '';
  /** Extra classes for the trigger (e.g. a max-width). */
  export let buttonClass = '';

  let open = false;
  let root: HTMLDivElement | undefined;

  $: current = options.find((option) => option.value === value)?.label ?? '';

  function pick(next: string): void {
    open = false;
    if (next !== value) onchange(next);
  }

  function onWindowClick(event: MouseEvent): void {
    if (!open) return;
    if (root && !root.contains(event.target as Node)) open = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

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
      class="absolute right-0 z-30 mt-1 min-w-full overflow-hidden rounded-xl bg-[var(--color-elevated)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
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
