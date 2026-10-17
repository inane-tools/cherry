import { expect, it } from 'vitest';
import { rowWindow, rowIndexes } from './virtualRows';
it('bounds the mounted queue to its viewport even with ten thousand tracks', () => {
  expect(rowWindow(10000, 0, 400, 50)).toEqual({ start: 0, end: 14 });
  const range = rowWindow(10000, 25000, 400, 50);
  expect(range).toEqual({ start: 494, end: 514 });
  expect(rowIndexes(10000, range.start, range.end)).toHaveLength(20);
});
it('clamps empty/shrunken queues and keeps a drag source mounted outside the window', () => {
  expect(rowWindow(0, 1000, 400, 50)).toEqual({ start: 0, end: 0 });
  const range = rowWindow(3, 20000, 400, 50);
  expect(range).toEqual({ start: 2, end: 3 });
  expect(rowIndexes(1000, 100, 103, 1)).toEqual([1, 100, 101, 102]);
  expect(rowIndexes(1000, 100, 103, 101)).toEqual([100, 101, 102]);
});
