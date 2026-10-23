<script lang="ts">
  import { renderReleaseNotes } from '$lib/ui/releaseNotes';
  import { openUrl } from '$lib/desktop/opener';
  import { notify } from '$lib/app/services/contextMenu';

  export let notes: string;
  $: rendered = renderReleaseNotes(notes);

  function externalLinks(node: HTMLElement) {
    const follow = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || !node.contains(link) || event.button > 1) return;
      event.preventDefault();
      void openUrl(link.getAttribute('href')!).catch(() => notify('Could not open the link'));
    };
    node.addEventListener('click', follow);
    node.addEventListener('auxclick', follow);
    return { destroy() { node.removeEventListener('click', follow); node.removeEventListener('auxclick', follow); } };
  }
</script>

<div class="release-notes mt-3" use:externalLinks>
  {#await rendered}
    <p>Loading release notes…</p>
  {:then html}
    {@html html}
  {:catch}
    <p>Release notes couldn’t be displayed.</p>
  {/await}
</div>

<style>
  .release-notes { font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
  .release-notes :global(:is(p, ul, ol, pre, blockquote, table)) { margin: 0.65em 0; }
  .release-notes :global(:is(h1, h2, h3, h4, h5, h6)) { margin: 1.2em 0 0.4em; color: var(--color-zinc-200); font-size: 13px; font-weight: 600; line-height: 1.4; }
  .release-notes :global(:is(h1, h2)) { font-size: 14px; }
  .release-notes :global(ul) { list-style: disc; padding-left: 1.5em; }
  .release-notes :global(ol) { list-style: decimal; padding-left: 1.5em; }
  .release-notes :global(li) { padding-left: 0.2em; margin: 0.3em 0; }
  .release-notes :global(strong), .release-notes :global(b) { color: var(--color-zinc-200); font-weight: 600; }
  .release-notes :global(a[href]) { color: var(--color-accent); text-decoration: underline; text-underline-offset: 2px; }
  .release-notes :global(a:focus-visible) { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .release-notes :global(code) { border-radius: 4px; background: color-mix(in oklab, var(--color-white) 6%, transparent); padding: 0.1em 0.3em; font-size: 0.92em; }
  .release-notes :global(pre) { white-space: pre-wrap; border-radius: 8px; background: rgb(127 127 127 / 10%); padding: 0.7em 0.9em; }
  .release-notes :global(pre code) { background: transparent; padding: 0; }
  .release-notes :global(blockquote) { border-left: 2px solid var(--color-accent); padding-left: 0.9em; }
  .release-notes :global(hr) { margin: 1em 0; border: 0; border-top: 1px solid rgb(127 127 127 / 20%); }
  .release-notes :global(table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .release-notes :global(th), .release-notes :global(td) { border-bottom: 1px solid rgb(127 127 127 / 20%); padding: 0.4em; text-align: left; vertical-align: top; }
  .release-notes :global(:first-child) { margin-top: 0; }
  .release-notes :global(:last-child) { margin-bottom: 0; }
</style>
