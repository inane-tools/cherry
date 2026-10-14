import { invokeSafe, invokeStrict } from './platform';

export type PlaylistShortcut = { browseId: string; title: string; thumbnail: string };

/** Build small native shortcut icons without blocking playback/menu updates. */
export async function prepareJumpArtwork(shortcuts: PlaylistShortcut[]): Promise<boolean> {
  let changed = false;
  const urls = [...new Set(shortcuts.map((p) => p.thumbnail).filter(Boolean))].slice(0, 24);
  async function cache(url: string) {
    try {
      if (await invokeSafe<boolean>('jump_artwork_cached', { thumbnail: url })) return;
      const base64 = await invokeSafe<string>('http_proxy_fetch_base64', { url });
      if (!base64) return;
      const image = new Image();
      const format = base64.startsWith('iVBOR') ? 'png' : base64.startsWith('UklGR') ? 'webp' : 'jpeg';
      image.src = `data:image/${format};base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context || !image.naturalWidth || !image.naturalHeight) return;
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 64, 64);
      await invokeStrict('cache_jump_artwork', { thumbnail: url, pngBase64: canvas.toDataURL('image/png').split(',')[1] });
      changed = true;
    } catch { /* Missing artwork keeps the app icon as a fallback. */ }
  }
  // Two concurrent downloads; playlist changes should never flood the network.
  for (let i = 0; i < urls.length; i += 2) await Promise.all(urls.slice(i, i + 2).map(cache));
  return changed;
}
