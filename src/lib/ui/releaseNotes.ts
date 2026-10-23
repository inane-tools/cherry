/** GitHub/electron-updater can supply Markdown, rendered HTML, or both. */
export async function renderReleaseNotes(notes: string): Promise<string> {
  const [{ marked }, { default: purifier }] = await Promise.all([import('marked'), import('dompurify')]);
  const fragment = purifier.sanitize(marked.parse(notes, { async: false, gfm: true }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'a', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const link of fragment.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href')!, 'https://github.com/inane-tools/cherry/releases');
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsupported link');
      link.setAttribute('href', url.href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    } catch { link.removeAttribute('href'); }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
