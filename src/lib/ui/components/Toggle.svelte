<script lang="ts">
  /**
   * Small switch used for boolean settings.
   *
   * A real `role="switch"` button rather than a styled checkbox: it keeps the
   * keyboard/assistive behaviour correct while looking like the rest of the app
   * instead of a browser-default control.
   */
  export let checked = false;
  export let label = '';
  export let disabled = false;
  export let onchange: (value: boolean) => void = () => {};
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 {checked
    ? 'bg-[var(--color-accent)]'
    : 'bg-white/12 hover:bg-white/20'}"
  onclick={() => onchange(!checked)}
>
  <!-- Track is 36x20, thumb 16px, 2px inset on every side => travel is 16px.
       Positioning with `left` (rather than a translate) keeps the inset exact
       and identical on both ends, which is what was misaligned. -->
  <span
    class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 {checked
      ? 'translate-x-4'
      : 'translate-x-0'}"
  ></span>
</button>
