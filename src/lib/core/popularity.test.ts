import { expect, it } from 'vitest';
import { popularityLevel } from './popularity';
it('compares plays within the album, with at most five bars and at least one for a played song', () => {
  expect(popularityLevel(100, 100)).toBe(5);
  expect(popularityLevel(40, 100)).toBe(2);
  expect(popularityLevel(1, 100)).toBe(1);
  expect(popularityLevel(0, 100)).toBe(0);
  expect(popularityLevel(undefined, 100)).toBeUndefined();
  expect(popularityLevel(NaN, 100)).toBeUndefined();
});
