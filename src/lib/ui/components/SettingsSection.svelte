<script lang="ts">
  /**
   * Settings section card: a consistent shell (title, optional description,
   * optional trailing action) so every section lines up instead of each one
   * re-inventing its own paddings and borders.
   */
  export let title = '';
  export let description = '';
  /** `accent` highlights the app/about card; `warn` the disclaimer. */
  export let tone: 'default' | 'accent' | 'warn' = 'default';
  /** Smaller title, used by the account section's username. */
  export let compact = false;
  /** Only reveal the description while hovering the header. */
  export let hoverDescription = false;
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
      ? 'bg-gradient-to-br from-[var(--color-accent)]/10 to-transparent'
      : tone === 'warn'
        ? 'bg-amber-500/5'
        : 'bg-[var(--color-card)]';

  $: titleClass = tone === 'warn' ? 'text-amber-200' : 'text-white';
  $: titleSize = compact
    ? 'text-[13px] font-semibold'
    : 'text-[18px] font-extrabold tracking-tight sm:text-[20px]';
</script>

<section class="rounded-xl px-5 py-4 {shell}">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex : role is `button` whenever the tabindex is set -->
  <div
    class="group flex items-center gap-3 {collapsible ? 'cursor-pointer select-none' : ''}"
    role={collapsible ? 'button' : undefined}
    tabindex={collapsible ? 0 : undefined}
    aria-expanded={collapsible ? expanded : undefined}
    onclick={toggle}
    onkeydown={onHeaderKey}
  >
    <slot name="leading" />
    <div class="min-w-0 flex-1">
      <h2 class="{titleSize} leading-tight {titleClass}">{title}</h2>
      {#if description}
        <p
          class="mt-0.5 text-[11px] leading-relaxed text-zinc-500 {hoverDescription
            ? 'opacity-0 transition-opacity duration-150 group-hover:opacity-100'
            : ''}">{description}</p>
      {/if}
    </div>
    <slot name="action" />
    {#if collapsible}
      <i
        class="bx {expanded ? 'bx-chevron-up' : 'bx-chevron-down'} shrink-0 text-xl text-zinc-500"
        aria-hidden="true"
      ></i>
    {/if}
  </div>
  {#if collapsible}
    <!-- Height slide via `grid-template-rows` (0fr → 1fr): animates the open/
         close without setting an explicit pixel height, which kept the overlay's
         scroll geometry sane. -->
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out {expanded
        ? 'grid-rows-[1fr]'
        : 'grid-rows-[0fr]'}"
      inert={!expanded}
    >
      <div class="min-h-0 overflow-hidden">
        <div class="mt-4"><slot /></div>
      </div>
    </div>
  {:else}
    <div class="mt-4"><slot /></div>
  {/if}
</section>
