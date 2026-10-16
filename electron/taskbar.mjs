/** Small native toolbar glyphs; no remote assets or image dependencies. */
export function createTaskbarControls({ nativeImage, platform = process.platform, dispatch }) {
  const icons = new Map();
  function icon(kind) {
    if (icons.has(kind)) return icons.get(kind);
    const size = 32, bytes = Buffer.alloc(size * size * 4);
    const inside = (x, y) => {
      if (kind === 'pause') return y >= 7 && y <= 25 && ((x >= 9 && x <= 13) || (x >= 19 && x <= 23));
      if (kind === 'prev') x = size - x;
      if (kind === 'next' || kind === 'prev') return (x >= 23 && x <= 25 && y >= 8 && y <= 24) || (x >= 8 && x <= 22 && Math.abs(y - 16) <= (22 - x) * 8 / 14);
      return x >= 10 && x <= 25 && Math.abs(y - 16) <= (25 - x) * 9 / 15;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let covered = 0;
      for (const dy of [.25, .75]) for (const dx of [.25, .75]) if (inside(x + dx, y + dy)) covered++;
      const offset = (y * size + x) * 4;
      bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = 255; bytes[offset + 3] = Math.round(255 * covered / 4);
    }
    const image = nativeImage.createFromBitmap(bytes, { width: size, height: size, scaleFactor: 1 });
    icons.set(kind, image); return image;
  }
  return (window, state) => {
    if (platform !== 'win32' || !window || window.isDestroyed()) return;
    const flags = state.hasTrack ? [] : ['disabled'];
    return window.setThumbarButtons([
      { tooltip: 'Previous', icon: icon('prev'), flags, click: () => dispatch('prev') },
      { tooltip: state.playing ? 'Pause' : 'Play', icon: icon(state.playing ? 'pause' : 'play'), flags, click: () => dispatch('toggle') },
      { tooltip: 'Next', icon: icon('next'), flags, click: () => dispatch('next') },
    ]);
  };
}
