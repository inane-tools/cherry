<script lang="ts">
  import { slide } from 'svelte/transition';

  /**
   * Settings section card: a consistent shell (title, optional icon/description,
   * optional trailing action) so every section lines up instead of each one
   * re-inventing its own paddings and borders.
   */
  export let title = '';
  export let description = '';
  /** Boxicons class for the leading tile, e.g. `bx bxl-discord-alt`. */
  export let icon = '';
  /** `accent` highlights the app/about card; `warn` the disclaimer. */
  export let tone: 'default' | 'accent' | 'warn' = 'default';
  /** Turn the header into a toggle that shows/hides the body. */
  export let collapsible = false;
  /** Whether a collapsible section starts open (defaults to collapsed). */
  export let open = false;

  let expanded = open;

  function toggle(): void {
    if (collapsible) expanded = !expanded;
  }

  function onHeaderKey(event: KeyboardEvent): void {
    if (!collapsible) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  }

  $: shell =
    tone === 'accent'
      ? 'border-[var(--color-accent)]/25 bg-gradient-to-br from-[var(--color-accent)]/10 to-transparent'
      : tone === 'warn'
        ? 'border-amber-500/25 bg-amber-500/5'
        : 'border-white/[0.06] bg-[#121217]';

  $: tile =
    tone === 'accent'
      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent2)]'
      : tone === 'warn'
        ? 'bg-amber-500/10 text-amber-200'
        : 'bg-white/[0.06] text-zinc-300';

  $: titleClass = tone === 'warn' ? 'text-amber-200' : 'text-white';
</script>

<section class="rounded-xl border p-5 {shell}">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex : role is `button` whenever the tabindex is set -->
  <div
    class="flex items-center gap-3 {collapsible ? 'cursor-pointer select-none' : ''}"
    role={collapsible ? 'button' : undefined}
    tabindex={collapsible ? 0 : undefined}
    aria-expanded={collapsible ? expanded : undefined}
    onclick={toggle}
    onkeydown={onHeaderKey}
  >
    {#if icon}
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {tile}">
        <i class="{icon} text-base"></i>
      </span>
    {:else}
      <slot name="leading" />
    {/if}
    <div class="min-w-0 flex-1">
      <h2 class="text-[13px] font-semibold {titleClass}">{title}</h2>
      {#if description}
        <p class="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{description}</p>
      {/if}
    </div>
    <slot name="action" />
    {#if collapsible}
      <i
        class="bx {expanded ? 'bx-chevron-up' : 'bx-chevron-down'} shrink-0 text-lg text-zinc-500"
        aria-hidden="true"
      ></i>
    {/if}
  </div>
  {#if !collapsible || expanded}
    <div class="mt-4" transition:slide={{ duration: 200 }}>
      <slot />
    </div>
  {/if}
</section>
