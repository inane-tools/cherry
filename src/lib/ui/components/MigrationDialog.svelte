<script lang="ts">
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { onMount } from 'svelte';
  import { invoke } from '$lib/desktop/core';
  import { errorMessage } from '$lib/app/services/platform';
  import DialogHeader from './DialogHeader.svelte';

  export let accepted: boolean;
  export let onClose: () => void;
  export let onLocked: (locked: boolean) => void;
  type Preview = { found: boolean; token?: string; source?: string; pins?: number; folders?: number;
    preferences?: number; skipped?: number; alreadyImported?: boolean; warnings: string[];
    credentialsSupported?: boolean; credentialsReady?: boolean };
  let preview: Preview | null = null;
  let busy = false;
  let error = '';
  let includeCredentials = true;
  let result: { backup: string; pins: number; folders: number; credentials?: { youtube: string; lastfm: string } } | null = null;
  let importing = false;
  let sheet: HTMLElement;
  function credentialLabel(status: string): string {
    return ({ imported: 'imported securely', kept: 'existing sign-in kept', 'not-found': 'no saved sign-in found', skipped: 'not imported' } as Record<string, string>)[status] ?? status;
  }

  async function inspect(pick = false): Promise<void> {
    if (!accepted || busy || result) return;
    busy = true; error = '';
    try {
      const value = await invoke<Preview | null>('migration_inspect', { accepted, pick });
      if (value) preview = value;
    } catch (e) { preview = null; error = errorMessage(e, 'Could not read the old settings.'); }
    finally { busy = false; }
  }
  async function migrate(): Promise<void> {
    if (!accepted || busy || !preview?.token || result) return;
    busy = true; importing = true; error = ''; onLocked(true);
    try {
      result = await invoke('migration_import', { accepted, token: preview.token,
        includeCredentials: includeCredentials && !!preview.credentialsReady });
    } catch (e) { error = errorMessage(e, 'Import failed. Inspect the file again to retry.'); preview = null; onLocked(false); }
    finally { busy = false; importing = false; }
  }
  async function restart(): Promise<void> {
    error = '';
    try { await invoke('app:relaunch'); }
    catch (e) { error = errorMessage(e, 'Close and reopen Cherry to finish.'); }
  }
  function close(): void { if (!busy && !result) onClose(); }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const buttons = [...sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = buttons[0]; const last = buttons.at(-1);
    if (!first) { event.preventDefault(); sheet.focus(); }
    else if (!sheet.contains(document.activeElement) || (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet)) { event.preventDefault(); first.focus(); }
  }
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheet.focus(); void inspect();
    return () => { previous?.focus(); };
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-[90] flex items-center justify-center bg-scrim/60 p-4" onclick={(event) => { if (event.target === event.currentTarget) close(); }}>
  <div bind:this={sheet} role="dialog" aria-modal="true" aria-label="Import from Tauri" aria-busy={busy}
    use:overlayScrollbar tabindex="-1" class="cherry-overlay-scroll max-h-full w-full max-w-lg rounded-2xl bg-[var(--color-popover)] text-white shadow-xl">
    {#if !busy && !result}
      <DialogHeader title="Import from Tauri" onClose={close} />
    {:else}
      <header class="px-6 pb-6 pt-6"><h2 class="text-[26px] font-extrabold tracking-tight">{result ? 'Ready to restart' : importing ? 'Importing data…' : 'Finding settings…'}</h2></header>
    {/if}
    <div class="space-y-4 px-6 pb-6 text-[13px] leading-relaxed">
      {#if result}
        <p>Your data was imported and verified. Restart Cherry to apply it.</p>
        {#if result.credentials}
          <p class="text-zinc-400">YouTube Music: {credentialLabel(result.credentials.youtube)}<br />Last.fm: {credentialLabel(result.credentials.lastfm)}</p>
          {#if result.credentials.youtube === 'imported'}<p class="text-zinc-400">If Google has expired the old session, or the wrong account opens, sign in again in Settings.</p>{/if}
          {#if ['not-found', 'skipped'].includes(result.credentials.youtube)}<p class="text-zinc-400">Sign in with YouTube Music in Settings to start listening.</p>{/if}
        {/if}
        <p class="text-zinc-400">Your previous Electron settings are backed up here:</p>
        <p class="select-text break-all text-[12px] text-zinc-400">{result.backup}</p>
        <button class="action primary" onclick={restart}>Restart Cherry</button>
      {:else}
        <p>Import appearance and player preferences, pins, playlist folders and sidebar order.</p>
        <div class="rounded-lg bg-amber-500/5 p-3">
          <p class="flex items-center gap-2 text-[12px] font-semibold text-amber-200">
            <i class="ph-fill ph-info text-base text-amber-200" aria-hidden="true"></i>
            Close the old Cherry app before importing.
          </p>
        </div>
        {#if preview?.found}
          <div class="space-y-1">
            <h3 class="font-semibold">Settings found</h3>
            <p class="select-text break-all text-[12px] text-zinc-500">{preview.source}</p>
            <p class="text-zinc-400">{preview.pins} pinned playlists · {preview.folders} folders</p>
            {#if preview.skipped}<p class="text-amber-300">{preview.skipped} unsupported or invalid preferences will be skipped.</p>{/if}
            {#if preview.alreadyImported}<p class="text-amber-300">This file was imported before. Importing again replaces preferences again.</p>{/if}
          </div>
          <label class="flex items-start gap-2">
            <input type="checkbox" bind:checked={includeCredentials} disabled={busy || !preview.credentialsReady} class="mt-1 accent-[var(--color-accent)]" />
            <span>Carry over YouTube Music sign-in and Last.fm</span>
          </label>
          {#if !preview.credentialsReady}<p class="text-amber-300">{preview.credentialsSupported ? 'Secure storage is unavailable. Unlock your OS keyring and restart Cherry to include sign-ins.' : 'Sign-in migration is available on Windows and Linux.'}</p>{/if}
        {:else if !busy}
          <p class="text-zinc-400">Choose <span class="font-semibold">cherry-settings.json</span> from the old app’s data folder. You can also select a copy from another computer.</p>
        {/if}
        {#each preview?.warnings ?? [] as warning}<p class="text-amber-300">{warning}</p>{/each}
        <div class="flex flex-wrap gap-2 pt-1">
          <button class="action primary" disabled={busy || !accepted || !preview?.token} onclick={migrate}>{importing ? 'Importing…' : 'Import data'}</button>
          <button class="action" disabled={busy || !accepted} onclick={() => inspect(true)}><i class="ph ph-folder-open text-base"></i> Choose settings file</button>
          {#if !preview && !busy}<button class="action" disabled={!accepted} onclick={() => inspect()}>Find again</button>{/if}
        </div>
      {/if}
      {#if error}<p role="alert" class="text-red-400">{error}</p>{/if}
    </div>
  </div>
</div>

<style>
  .action { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.5rem; background: rgb(255 255 255 / 0.06); padding: 0.5rem 1rem; font-size: 12px; font-weight: 600; }
  .action:hover { filter: brightness(1.1); }
  .action:disabled { cursor: not-allowed; opacity: 0.4; }
  .primary { background: var(--color-accent); color: white; }
</style>
