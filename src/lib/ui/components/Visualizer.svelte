<script lang="ts">
  /**
   * Experimental music visualizer drawn behind the whole window, in the spirit
   * of old media-player visualizers: a spectrum "flower" in the centre whose
   * outline is the live spectrum, rings that burst out on beats, sparks on the
   * treble and a few glows, all trailing through a zooming, turning feedback
   * echo so they spiral outward. Colours stay on and around the accents.
   *
   * It renders into a quarter-resolution canvas that the browser scales up, so
   * the cost stays low. The frame loop only runs while `active` (music
   * playing), the window is visible and reduced motion is off; otherwise the
   * layer fades out and the loop stops.
   */
  import { onDestroy, onMount } from 'svelte';
  import { readSpectrum, stopVisualizer } from '$lib/app/services/visualizer';

  export let active = false;

  /** Render scale against CSS pixels. */
  const SCALE = 1 / 4;
  const FRAME_MS = 1000 / 30;
  const GLOWS = 3;
  const PETALS = 48;
  const MAX_SPARKS = 40;

  let canvas: HTMLCanvasElement;
  let trail: HTMLCanvasElement | null = null;
  let frame = 0;
  let last = 0;
  let time = 0;
  let spin = 0;
  let hueShift = 0;
  let bassAverage = 0;
  let lastBeat = -Infinity;
  let energy = { bass: 0, mid: 0, treble: 0 };
  const bands = new Float32Array(24);
  const ripples: { radius: number; life: number; hue: number }[] = [];
  const sparks: { x: number; y: number; life: number; hue: number }[] = [];
  let palette = [350, 20];
  let paletteCheckedAt = -Infinity;
  let visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  let reduceMotion = false;
  let showing = false;

  /** Hue (degrees) of any CSS colour, via the canvas colour parser. */
  function hueOf(ctx: CanvasRenderingContext2D, colour: string): number | null {
    ctx.fillStyle = '#000';
    ctx.fillStyle = colour;
    const match = /^#([0-9a-f]{6})$/i.exec(String(ctx.fillStyle));
    if (!match) return null;
    const n = Number.parseInt(match[1], 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }

  function resize(): void {
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    const w = Math.max(16, Math.round(width * SCALE));
    const h = Math.max(16, Math.round(height * SCALE));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    trail ??= document.createElement('canvas');
    trail.width = w;
    trail.height = h;
  }

  function average(from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum += bands[i];
    return sum / (to - from);
  }

  function draw(now: number): void {
    frame = requestAnimationFrame(draw);
    if (now - last < FRAME_MS) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const ctx = canvas?.getContext('2d');
    const back = trail?.getContext('2d');
    if (!ctx || !back || !trail) return;
    const { width: w, height: h } = canvas;
    const size = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;

    if (now - paletteCheckedAt > 1000) {
      const styles = getComputedStyle(canvas);
      palette = [
        hueOf(ctx, styles.getPropertyValue('--color-accent').trim()) ?? palette[0],
        hueOf(ctx, styles.getPropertyValue('--color-accent2').trim()) ?? palette[1],
      ];
      paletteCheckedAt = now;
    }

    if (!readSpectrum(bands)) bands.fill(0);
    // Fast attack and a quick release, so the picture follows the music.
    const ease = (from: number, to: number) => from + (to - from) * (to > from ? 0.8 : 0.25);
    energy = {
      bass: ease(energy.bass, average(0, 5)),
      mid: ease(energy.mid, average(5, 14)),
      treble: ease(energy.treble, average(14, bands.length)),
    };
    // A beat is the bass jumping above its recent average, at most ~5 a second.
    const beat = energy.bass > 0.22 && energy.bass > bassAverage * 1.22 && now - lastBeat > 180;
    bassAverage += (energy.bass - bassAverage) * 0.06;
    if (beat) {
      lastBeat = now;
      hueShift += 14;
      ripples.push({ radius: size * (0.1 + energy.bass * 0.1), life: 1, hue: palette[1] });
    }
    // Hues sway around the accents instead of cycling the colour wheel; a beat
    // nudges them, and the nudge relaxes back.
    hueShift *= Math.pow(0.4, dt);
    time += dt * (0.3 + energy.mid * 1.6);
    // The flower turns with the mids and changes direction now and then.
    spin += dt * (0.2 + energy.mid * 2.5) * (Math.sin(time * 0.2) >= 0 ? 1 : -1);
    const hue = (i: number, offset = 0) => (palette[i % 2] + offset + Math.sin(time * 0.6 + i) * 20 + hueShift + 360) % 360;

    // Feedback: last frame zoomed and turned, so shapes spiral outward and fade.
    // Short trails leave dark gaps instead of building up a wash.
    back.clearRect(0, 0, w, h);
    back.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.76;
    ctx.translate(cx, cy);
    ctx.rotate(0.008 + energy.mid * 0.05);
    const zoom = 1.02 + energy.bass * 0.07;
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    ctx.drawImage(trail, 0, 0);
    ctx.restore();

    // A few small glows wandering on Lissajous paths.
    for (let i = 0; i < GLOWS; i++) {
      const phase = (i / GLOWS) * Math.PI * 2;
      const x = cx + Math.sin(time * (0.8 + i * 0.2) + phase) * w * 0.4;
      const y = cy + Math.cos(time * (0.6 + i * 0.25) + phase * 1.3) * h * 0.38;
      const level = i % 2 ? energy.mid : energy.bass;
      const radius = size * (0.06 + level * 0.22);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `hsla(${hue(i)}, 85%, 45%, ${0.06 + level * 0.32})`);
      glow.addColorStop(1, `hsla(${hue(i)}, 85%, 35%, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // Spectrum flower: mirrored bands around a circle, pulsing with the bass.
    const base = size * (0.1 + energy.bass * 0.08);
    const points: [number, number][] = [];
    for (let i = 0; i < PETALS; i++) {
      const band = bands[Math.min(bands.length - 1, i < PETALS / 2 ? i : PETALS - 1 - i)];
      const angle = (i / PETALS) * Math.PI * 2 + spin;
      const r = base + band * band * size * 0.32;
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    ctx.beginPath();
    for (let i = 0; i <= PETALS; i++) {
      const [x, y] = points[i % PETALS];
      const [nx, ny] = points[(i + 1) % PETALS];
      if (i === 0) ctx.moveTo((x + nx) / 2, (y + ny) / 2);
      else ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = `hsla(${hue(1)}, 80%, 30%, ${0.04 + energy.mid * 0.1})`;
    ctx.fill();
    ctx.lineWidth = 1 + energy.bass * 2;
    ctx.strokeStyle = `hsla(${hue(0)}, 90%, ${50 + energy.treble * 20}%, ${0.45 + energy.mid * 0.5})`;
    ctx.stroke();

    // Beat ripples racing outward.
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ring = ripples[i];
      ring.radius += size * dt * (0.9 + energy.bass * 1.2);
      ring.life -= dt * 1.4;
      if (ring.life <= 0) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
      ctx.lineWidth = 0.5 + ring.life * 2.5;
      ctx.strokeStyle = `hsla(${(ring.hue + hueShift) % 360}, 90%, 58%, ${ring.life * 0.7})`;
      ctx.stroke();
    }

    // Treble sparks.
    if (energy.treble > 0.3 && sparks.length < MAX_SPARKS) {
      for (let n = Math.round(energy.treble * 3); n > 0; n--) {
        const angle = Math.random() * Math.PI * 2;
        const distance = size * (0.15 + Math.random() * 0.6);
        sparks.push({ x: cx + Math.cos(angle) * distance * (w / size), y: cy + Math.sin(angle) * distance, life: 1, hue: hue(1, 20) });
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.life -= dt * 2.2;
      if (spark.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 0.6 + spark.life * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${spark.hue}, 90%, 70%, ${spark.life * 0.8})`;
      ctx.fill();
    }
  }

  function start(): void {
    if (frame) return;
    showing = true;
    last = performance.now();
    frame = requestAnimationFrame(draw);
  }

  function stop(): void {
    showing = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    ripples.length = 0;
    sparks.length = 0;
  }

  $: running = active && visible && !reduceMotion;
  $: if (canvas) running ? start() : stop();

  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = motion.matches;
    const onMotion = () => (reduceMotion = motion.matches);
    const onVisibility = () => (visible = document.visibilityState === 'visible');
    motion.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      motion.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  });

  onDestroy(() => {
    stop();
    void stopVisualizer();
  });
</script>

<canvas bind:this={canvas} class="cherry-visualizer pointer-events-none absolute inset-0 h-full w-full" class:showing aria-hidden="true"></canvas>
