import { expect, it } from 'vitest';
import { hueOf, washCompanion } from './themeColor';

it('gives saturated accents a neighboring hue without changing their range', () => {
  for (const accent of [{ r: 255, g: 77, b: 94 }, { r: 30, g: 130, b: 230 }, { r: 50, g: 180, b: 90 }]) {
    const companion = washCompanion(accent);
    expect((hueOf(accent) - hueOf(companion) + 360) % 360).toBeCloseTo(50);
    expect(Math.max(...Object.values(companion))).toBe(Math.max(...Object.values(accent)));
    expect(Math.min(...Object.values(companion))).toBe(Math.min(...Object.values(accent)));
  }
});

it('keeps neutral accents neutral', () => {
  expect(washCompanion({ r: 140, g: 140, b: 140 })).toEqual({ r: 140, g: 140, b: 140 });
  expect(washCompanion({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
});
