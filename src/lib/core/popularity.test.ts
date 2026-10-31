import { expect, it } from 'vitest';
import { popularityLevel } from './popularity';
it('spans one to five bars even when album counts are close together', () => {
  expect([800, 850, 900, 950, 1000].map(count => popularityLevel(count, 1000, 800))).toEqual([1, 2, 3, 4, 5]);
  expect(popularityLevel(0, 100, 0)).toBe(1);
  expect(popularityLevel(100, 100, 0)).toBe(5);
});
it('keeps tied counts equal and missing counts unavailable', () => {
  expect(popularityLevel(100, 100, 100)).toBe(5);
  expect(popularityLevel(0, 0, 0)).toBe(5);
  expect(popularityLevel(undefined, 100, 50)).toBeUndefined();
  expect(popularityLevel(NaN, 100, 50)).toBeUndefined();
  expect(popularityLevel(-1, 100, 50)).toBeUndefined();
});
