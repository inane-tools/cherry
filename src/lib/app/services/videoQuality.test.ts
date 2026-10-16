import { expect, it } from 'vitest';
import { pickVideoRepresentation, initialVideoBitrate } from './videoQuality';

const streams = [
  { id: '360', height: 360, bandwidth: 500000 },
  { id: '720-low', height: 720, bandwidth: 1000000 },
  { id: '720-high', height: 720, bandwidth: 2000000 },
  { id: '1080', height: 1080, bandwidth: 4000000 },
];
it('selects the preferred resolution and the best bitrate at that size', () => {
  expect(pickVideoRepresentation(streams, '720')?.id).toBe('720-high');
});
it('prefers the highest available stream without adapting to a lower resolution', () => {
  expect(pickVideoRepresentation(streams, 'highest')?.id).toBe('1080');
});
it('starts Auto at the highest available bitrate and manual mode at its chosen resolution', () => {
  const manifest = '<MPD><Period><AdaptationSet contentType="video"><Representation id="720" height="720" bandwidth="2000000"/><Representation id="1080" height="1080" bandwidth="6000000"/></AdaptationSet></Period></MPD>';
  expect(initialVideoBitrate(manifest, 'auto')).toBe(6000);
  expect(initialVideoBitrate(manifest, '720')).toBe(2000);
  expect(initialVideoBitrate('<MPD/>', 'auto')).toBe(4000);
});
it('uses the nearest lower resolution without mutating the available streams', () => {
  const limited = streams.filter(stream => stream.height < 1080);
  expect(pickVideoRepresentation(limited, '1080')?.id).toBe('720-high');
  expect(pickVideoRepresentation(streams, '1080')?.id).toBe('1080');
  expect(streams[0].id).toBe('360');
});
it('uses the lowest available quality when all streams exceed the preference', () => {
  expect(pickVideoRepresentation(streams, '144')?.id).toBe('360');
});
it('lets the player adapt automatically for Auto or an invalid preference', () => {
  expect(pickVideoRepresentation(streams, 'auto')).toBeUndefined();
  expect(pickVideoRepresentation(streams, 'broken')).toBeUndefined();
  expect(pickVideoRepresentation([], '1080')).toBeUndefined();
});
