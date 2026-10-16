import { artwork } from './artwork';

/** Warm only the current cover, retaining decoded images until it changes. */
export function preloadArtwork(groups: string[][], onready?: (urls: string[], image: HTMLImageElement) => void): () => void {
  const unique = [...new Map(groups.filter(urls => urls.length).map(urls => [JSON.stringify(urls), urls])).values()];
  const images = unique.map(urls => {
    const image = new Image();
    let disposed = false;
    image.decoding = 'async';
    const action = artwork(image, { urls });
    const decode = async () => {
      try { await image.decode?.(); } catch { /* A loaded image is still usable. */ }
      if (!disposed) onready?.(urls, image);
    };
    image.addEventListener('load', decode);
    return () => {
      disposed = true;
      action.destroy();
      image.removeEventListener('load', decode);
      image.removeAttribute('src');
    };
  });
  return () => images.forEach(dispose => dispose());
}
