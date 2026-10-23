import { expect, it } from 'vitest';
import { renderReleaseNotes } from './releaseNotes';

async function render(notes: string) {
  const container = document.createElement('div');
  container.innerHTML = await renderReleaseNotes(notes);
  return container;
}

it('renders Markdown headings, lists, emphasis, links and code', async () => {
  const output = await render('## Fixed\n\n- **Playback** stays active.\n- Use `Cherry`.\n\n[Release](https://github.com/inane-tools/cherry/releases/tag/v2.0.1)');
  expect(output.querySelector('h2')?.textContent).toBe('Fixed');
  expect(output.querySelectorAll('li')).toHaveLength(2);
  expect(output.querySelector('strong')?.textContent).toBe('Playback');
  expect(output.querySelector('code')?.textContent).toBe('Cherry');
  expect(output.querySelector('a')?.getAttribute('href')).toBe('https://github.com/inane-tools/cherry/releases/tag/v2.0.1');
});

it('preserves GitHub HTML release notes, entities and nested lists', async () => {
  const output = await render('<h2>Changes &amp; fixes</h2><ul><li>Player<ul><li><em>Smoother</em> transitions</li></ul></li></ul><p><a href="/inane-tools/cherry/pull/123">Details</a></p>');
  expect(output.querySelector('h2')?.textContent).toBe('Changes & fixes');
  expect(output.querySelector('li li em')?.textContent).toBe('Smoother');
  expect(output.querySelector('a')?.getAttribute('href')).toBe('https://github.com/inane-tools/cherry/pull/123');
});

it('strips executable markup, embedded content, styling and unsafe links', async () => {
  const output = await render('<script>alert(1)</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><img src="https://example.com/track" onerror="alert(1)"><p style="position:fixed" onclick="alert(1)">Safe text</p><a href="javascript:alert(1)">script</a> <a href="file:///private">file</a> <a href="cherry://app">app</a> <a href="https://user:pass@example.com">credentials</a>');
  expect(output.querySelector('script, style, iframe, img, [style], [onclick], [onerror], a[href]')).toBeNull();
  expect(output.textContent).toContain('Safe text');
});

it('shows Markdown code examples literally without executing their HTML', async () => {
  const output = await render('```html\n<script>alert(1)</script>\n```');
  expect(output.querySelector('script')).toBeNull();
  expect(output.querySelector('pre code')?.textContent).toContain('<script>alert(1)</script>');
});
