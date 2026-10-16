<script lang="ts">
  import { onMount } from 'svelte';
  import { updateStore, initializeUpdates, checkUpdates, downloadUpdate, installUpdate } from '$lib/app/services/updates';
  onMount(() => { void initializeUpdates().catch(() => {}); });
  $: supported = ['windows', 'appimage'].includes($updateStore.environment);
  $: busy = ['checking', 'downloading', 'installing'].includes($updateStore.phase);
  $: percent = $updateStore.total ? Math.min(100, Math.round($updateStore.received / $updateStore.total * 100)) : null;
</script>

<div id="cherry-updates" class="mt-4 border-t border-white/[0.06] pt-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0 text-sm" aria-live="polite">
      <p class="flex items-center gap-2 font-semibold text-white"><i class="bx bx-refresh text-base text-zinc-400" aria-hidden="true"></i>Updates</p>
      <p class="mt-1 text-xs text-zinc-400">
        {#if !$updateStore.initialized}Loading update support…
        {:else if $updateStore.environment === 'flatpak'}Update through your software manager or Flatpak repository. GitHub bundles can be installed manually.
        {:else if !supported}Updates are available in installed Windows and AppImage releases; development builds do not install updates.
        {:else if $updateStore.phase === 'checking'}Checking for updates…
        {:else if $updateStore.phase === 'current'}You’re up to date.
        {:else if $updateStore.phase === 'available'}Cherry {$updateStore.version} is available.
        {:else if $updateStore.phase === 'downloading'}Downloading{percent === null ? '…' : ` · ${percent}%`}
        {:else if $updateStore.phase === 'ready'}Cherry {$updateStore.version} is ready. Installing will close and restart Cherry.
        {:else if $updateStore.phase === 'installing'}Installing and restarting…
        {:else}Checks at startup. Downloads and installation start when you choose.{/if}
      </p>
    </div>
    {#if supported}
      <div class="flex flex-wrap items-center gap-2">
      {#if $updateStore.phase === 'ready'}
        <button class="update-button" onclick={() => installUpdate()}>Install and restart</button>
      {:else if $updateStore.phase === 'available' || ($updateStore.phase === 'error' && $updateStore.version)}
        <button class="update-button" onclick={() => downloadUpdate()}>Download</button>
      {/if}
      <button class="update-button" disabled={busy} onclick={() => checkUpdates()}>{busy ? 'Please wait…' : 'Check for updates'}</button>
      </div>
    {/if}
  </div>
  {#if $updateStore.phase === 'downloading'}
    <progress class="update-progress mt-3" aria-label="Update download" max="100" value={percent ?? undefined}></progress>
  {/if}
  {#if $updateStore.error}<p class="mt-3 break-words text-xs text-red-400" role="alert">{$updateStore.error}</p>{/if}
  {#if $updateStore.notes && ['available', 'ready'].includes($updateStore.phase)}
    <details class="mt-3 text-xs text-zinc-400"><summary class="cursor-pointer">Release notes</summary><p class="mt-2 whitespace-pre-wrap">{$updateStore.notes}</p></details>
  {/if}
</div>

<style>
  .update-button { display: flex; height: 32px; flex-shrink: 0; align-items: center; gap: 6px; align-self: center; border-radius: 8px; padding: 0 12px; background: color-mix(in oklab, var(--color-white) 6%, transparent); color: var(--color-zinc-300); font-size: 11px; font-weight: 500; cursor: pointer; transition: color 150ms, background-color 150ms; }
  .update-button:hover:not(:disabled) { background: color-mix(in oklab, var(--color-white) 12%, transparent); color: var(--color-white); }
  .update-button:disabled { opacity: .5; cursor: default; }
  .update-button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
  .update-progress { appearance: none; display: block; width: 100%; height: 6px; overflow: hidden; border: 0; border-radius: 999px; background: var(--color-avatar); accent-color: var(--color-accent); }
  .update-progress::-webkit-progress-bar { background: var(--color-avatar); border-radius: 999px; }
  .update-progress::-webkit-progress-value { background: var(--color-accent); border-radius: 999px; }
  .update-progress::-moz-progress-bar { background: var(--color-accent); border-radius: 999px; }
  .update-progress:indeterminate { background: linear-gradient(to right, var(--color-accent) 40%, var(--color-avatar) 40%); }
  .update-progress:indeterminate::-webkit-progress-bar { background: transparent; }
</style>
