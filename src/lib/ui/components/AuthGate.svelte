<script lang="ts">
  import { go } from '$lib/app/services/navigation';
  import { DISCLAIMER } from '$lib/app/services/gate';
  import logoUrl from '$lib/assets/logo.png';
  import inaneWordmark from '$lib/assets/inane.svg';
  import { isDesktop } from '$lib/app/services/platform';
  import MigrationDialog from './MigrationDialog.svelte';

  /**
   * Full-window sign-in gate.
   *
   * Cherry needs a signed-in Premium account (anonymous streams are PO-token
   * gated), so while signed out `App.svelte` covers the whole window with this
   * instead of the UI. Nothing behind it is visible or clickable.
   *
   * The disclaimer must be accepted before Settings (where sign-in lives)
   * becomes reachable; acceptance is local to this view.
   */
  export let title = 'Welcome to Cherry :3';

  /**
   * Whether the user may proceed to Settings.
   *
   * Deliberately per-view and never remembered: the disclaimer must be
   * acknowledged every time the gate is shown. Persisting acceptance pre-ticked
   * the box on later launches, which defeated the point — so the checkbox now
   * always starts clear and only the current session unlocks the button.
   */
  let accepted = false;
  let migrationOpen = false;
  let migrationLocked = false;
  $: if (!accepted && !migrationLocked) migrationOpen = false;
</script>

<div class="relative flex h-full w-full items-center justify-center px-6 py-16">
  <div class="w-full max-w-md rounded-2xl bg-[var(--color-popover)] p-8 text-left">
    <img src={logoUrl} alt="Cherry" class="h-16 w-16 rounded-2xl shadow-lg" />
    <h2 class="mt-4 text-lg font-bold text-white">{title}</h2>
    <p class="mt-2 max-w-sm text-[13px] leading-relaxed text-zinc-500">
      Sign in with YouTube Music in settings to start listening.
    </p>

    <div class="mt-5 rounded-lg bg-amber-500/5 p-3 text-left">
      <h3 class="flex items-center gap-2 text-[12px] font-semibold text-amber-200">
        <i class="ph-fill ph-info text-base text-amber-200"></i>
        Disclaimer
      </h3>
      <p class="mt-1.5 text-[11px] leading-relaxed text-amber-100/80">
        {DISCLAIMER}
      </p>
      <label class="mt-3 flex items-center gap-2 text-[11px] text-amber-100/90">
        <input
          type="checkbox"
          checked={accepted}
          disabled={migrationLocked}
          onchange={(e) => (accepted = (e.currentTarget as HTMLInputElement).checked)}
          class="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        I have read and accept this
      </label>
    </div>

    <div class="mt-5 flex flex-wrap items-center gap-2">
      <button
        class="cherry-btn-scrim inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!accepted || migrationLocked}
        onclick={() => go('settings')}
      >
        <i class="ph-fill ph-gear-six text-base text-white"></i>
        Settings
      </button>
      {#if isDesktop()}
        <button
          class="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2 text-[12px] font-semibold text-zinc-300 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!accepted || migrationLocked}
          onclick={() => (migrationOpen = true)}
        ><i class="ph ph-download-simple text-base"></i> Migrate from 1.x</button>
      {/if}
    </div>
  </div>

  <span class="absolute bottom-5 left-6 text-[11px] tabular-nums text-zinc-500">
    v{__APP_VERSION__}
  </span>
  <img
    src={inaneWordmark}
    alt="inane.tools"
    class="inane-wordmark absolute bottom-5 right-6 h-6 w-auto opacity-70"
  />
</div>

{#if migrationOpen}
  <MigrationDialog {accepted} onClose={() => (migrationOpen = false)} onLocked={(locked) => (migrationLocked = locked)} />
{/if}
