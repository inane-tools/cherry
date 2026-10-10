<script lang="ts">
  // Moon button + popover for the sleep timer. Shows the remaining time while
  // a timed timer runs (ticking once a second only while one is running).
  import { onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import {
    SLEEP_PRESETS,
    cancelSleepTimer,
    formatCountdown,
    secondsLeft,
    sleepAfterTrack,
    sleepTimerStore,
    startSleepTimer,
  } from '$lib/app/services/sleepTimer';

  /** Larger icon for the full-screen player. */
  export let size: 'sm' | 'lg' = 'sm';

  let open = false;
  let now = Date.now();
  let ticker: ReturnType<typeof setInterval> | null = null;

  $: timer = $sleepTimerStore;
  $: active = timer.mode !== 'off';
  $: remaining = secondsLeft(timer, now);
  $: label =
    timer.mode === 'time'
      ? `Sleep in ${formatCountdown(remaining)}`
      : timer.mode === 'track'
        ? 'Sleep at end of track'
        : 'Sleep timer';

  $: if (timer.mode === 'time' && !ticker) {
    now = Date.now();
    ticker = setInterval(() => (now = Date.now()), 1000);
  } else if (timer.mode !== 'time' && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  onDestroy(() => {
    if (ticker) clearInterval(ticker);
  });

  function choose(action: () => void) {
    action();
    open = false;
  }

  function onWindowMouseDown(event: MouseEvent) {
    if (!open) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-sleep-timer]')) return;
    open = false;
  }
  function onWindowKey(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false;
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onWindowKey} />

<div class="relative flex items-center" data-sleep-timer>
  <button
    class="flex h-9 items-center justify-center gap-1 rounded-full {size === 'lg' ? 'text-xl' : 'text-lg'} {active
      ? 'text-[var(--color-accent2)]'
      : 'text-zinc-400 hover:text-white'} {timer.mode === 'time' ? 'px-2' : 'w-9'}"
    onclick={() => (open = !open)}
    title={label}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <i class="bx {active ? 'bxs-moon' : 'bx-moon'}"></i>
    {#if timer.mode === 'time'}
      <span class="text-[11px] font-medium tabular-nums">{formatCountdown(remaining)}</span>
    {/if}
  </button>

  {#if open}
    <div
      role="menu"
      class="absolute bottom-full right-0 z-30 mb-2 w-52 overflow-hidden rounded-xl bg-[var(--color-popover)] py-1.5 text-[12px] shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      in:fly={{ y: 6, duration: 140 }}
      out:fade={{ duration: 100 }}
    >
      <p class="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Sleep timer</p>
      {#each SLEEP_PRESETS as minutes (minutes)}
        <button
          role="menuitem"
          class="flex w-full items-center justify-between px-3 py-1.5 text-left text-zinc-200 hover:bg-white/5"
          onclick={() => choose(() => startSleepTimer(minutes))}
        >
          <span>{minutes < 60 ? `${minutes} minutes` : minutes === 60 ? '1 hour' : `${minutes / 60} hours`}</span>
          {#if timer.mode === 'time' && timer.minutes === minutes}<i class="bx bx-check text-[var(--color-accent2)]"></i>{/if}
        </button>
      {/each}
      <button
        role="menuitem"
        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-zinc-200 hover:bg-white/5"
        onclick={() => choose(sleepAfterTrack)}
      >
        <span>End of track</span>
        {#if timer.mode === 'track'}<i class="bx bx-check text-[var(--color-accent2)]"></i>{/if}
      </button>
      {#if active}
        <div class="my-1"></div>
        <button
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-300 hover:bg-rose-500/10"
          onclick={() => choose(cancelSleepTimer)}
        >
          <i class="bx bx-x"></i> Turn off
        </button>
      {/if}
    </div>
  {/if}
</div>
