import { readonly, writable } from 'svelte/store';

/** One brief untimed-lyrics prompt per queue entry, retained across player expansion. */
export function createLyricsPrompt(delay = 5000) {
  const visible = writable(false);
  let track = '';
  let dismissed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  return {
    visible: readonly(visible),
    update(key: string, eligible: boolean) {
      if (key !== track) { cancel(); track = key; dismissed = false; }
      const show = !!key && eligible && !dismissed;
      visible.set(show);
      if (!show) { cancel(); return; }
      if (timer === undefined) timer = setTimeout(() => {
        timer = undefined; dismissed = true; visible.set(false);
      }, delay);
    },
    destroy() { cancel(); },
  };
}
