<script lang="ts">
  import { go } from '$lib/app/services/navigation';
  import { DISCLAIMER } from '$lib/app/services/gate';
  import logoUrl from '$lib/assets/logo.png';
  import inaneWordmark from '$lib/assets/inane.svg';

  /**
   * Full-window sign-in gate.
   *
   * Cherry needs a signed-in Premium account (anonymous streams are PO-token
   * gated), so while signed out `App.svelte` covers the whole window with this
   * instead of the UI. Nothing behind it is visible or clickable.
   *
   * The disclaimer must be accepted before Settings (where sign-in lives)
   * becomes reachable; acceptance is remembered so it is asked once.
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
        <i class="bx bxs-info-circle text-base text-amber-200"></i>
        Disclaimer
      </h3>
      <p class="mt-1.5 text-[11px] leading-relaxed text-amber-100/80">
        {DISCLAIMER}
      </p>
      <label class="mt-3 flex items-center gap-2 text-[11px] text-amber-100/90">
        <input
          type="checkbox"
          checked={accepted}
          onchange={(e) => (accepted = (e.currentTarget as HTMLInputElement).checked)}
          class="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        I have read and accept this
      </label>
    </div>

    <button
      class="cherry-btn-scrim mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[12px] font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={!accepted}
      onclick={() => go('settings')}
    >
      <i class="bx bx-cog text-base text-white"></i>
      Settings
    </button>
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
