import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const getInfo = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ getInfo, session: { player: {} } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getAudioStream, clearStreamCache, resetInnertubeClient } from './InnertubeClient';

const format = (itag: number, height: number, bitrate: number, mime_type = 'video/mp4; codecs="avc1.640028"') => ({
  itag, height, bitrate, mime_type, has_video: height > 0, has_audio: height === 0 || itag === 18 || itag === 22,
  url: `https://stream.test/${itag}`, decipher: async () => `https://stream.test/${itag}`,
  init_range: { start: 0, end: 100 }, index_range: { start: 101, end: 200 },
});
beforeEach(() => {
  resetInnertubeClient(); clearStreamCache(); getInfo.mockReset();
  vi.stubGlobal('MediaSource', { isTypeSupported: (mime: string) => !mime.includes('unsupported') });
});
afterEach(() => vi.unstubAllGlobals());

const progressiveInfo = () => ({ playability_status: { status: 'OK' }, streaming_data: { formats: [format(18, 360, 1000000)], adaptive_formats: [] } });

it('shares a pending stream lookup between prefetch and playback', async () => {
  let resolve!: (info: ReturnType<typeof progressiveInfo>) => void;
  getInfo.mockReturnValue(new Promise(done => { resolve = done; }));
  const first = getAudioStream('shared');
  const second = getAudioStream('shared');
  await vi.waitFor(() => expect(getInfo).toHaveBeenCalledOnce());
  resolve(progressiveInfo());
  expect(await first).toEqual(await second);
  expect(getInfo).toHaveBeenCalledOnce();
});

it('does not reuse streams between accounts or repopulate a cleared cache from an old request', async () => {
  let resolve!: (info: ReturnType<typeof progressiveInfo>) => void;
  getInfo.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(progressiveInfo());
  const old = getAudioStream('song');
  await vi.waitFor(() => expect(getInfo).toHaveBeenCalledOnce());
  clearStreamCache();
  resolve(progressiveInfo());
  await old;
  await getAudioStream('song');
  expect(getInfo).toHaveBeenCalledTimes(2);
  await getAudioStream('song', { kind: 'cookie', cookie: 'different', savedAt: 0 });
  expect(getInfo).toHaveBeenCalledTimes(3);
});

it('prefers resolution over bitrate and supplies a supported HD manifest', async () => {
  const hd = format(137, 1080, 4000000);
  const huge = format(313, 2160, 12000000);
  const unsupported = format(999, 1080, 4000000, 'video/unsupported');
  const audio = format(140, 0, 128000, 'audio/mp4; codecs="mp4a.40.2"');
  const toDash = vi.fn(async (_options: { format_filter: (value: ReturnType<typeof format>) => boolean }) => '<MPD/>');
  getInfo.mockResolvedValue({ playability_status: { status: 'OK' }, basic_info: { duration: 200 },
    streaming_data: { formats: [format(18, 360, 8000000), format(22, 720, 2000000)], adaptive_formats: [hd, huge, unsupported, audio] }, toDash });
  const result = await getAudioStream('song', null, { video: true });
  expect(result.stream).toMatchObject({ url: 'https://stream.test/22', dashManifest: '<MPD/>' });
  const reject = toDash.mock.calls[0][0].format_filter;
  expect(reject(hd)).toBe(false);
  expect(reject(audio)).toBe(false);
  expect(reject(huge)).toBe(true);
  expect(reject(unsupported)).toBe(true);
  expect(reject({ ...hd, url: '', decipher: async () => '' })).toBe(true);
  expect(reject({ ...hd, index_range: undefined } as unknown as ReturnType<typeof format>)).toBe(true);
});

it('keeps looking for HD after a client supplies only a low-resolution file', async () => {
  const low = { playability_status: { status: 'OK' }, streaming_data: {
    formats: [format(18, 360, 1000000)],
    adaptive_formats: [{ ...format(137, 1080, 4000000), url: '' }],
  }, toDash: vi.fn() };
  const hd = { playability_status: { status: 'OK' }, streaming_data: {
    formats: [], adaptive_formats: [format(137, 1080, 4000000), format(140, 0, 128000, 'audio/mp4')],
  }, toDash: vi.fn().mockResolvedValue('<MPD/>') };
  getInfo.mockResolvedValueOnce(low).mockResolvedValue(hd);
  const result = await getAudioStream('song', null, { video: true });
  expect(getInfo).toHaveBeenCalledTimes(2);
  expect(low.toDash).not.toHaveBeenCalled();
  expect(result.stream).toMatchObject({ url: 'https://stream.test/18', dashManifest: '<MPD/>' });
});

it('retains progressive playback when adaptive manifest generation fails', async () => {
  getInfo.mockResolvedValue({ playability_status: { status: 'OK' }, streaming_data: {
    formats: [format(18, 360, 1000000)],
    adaptive_formats: [format(137, 1080, 4000000), format(140, 0, 128000, 'audio/mp4')],
  }, toDash: vi.fn().mockRejectedValue(new Error('Unavailable')) });
  const result = await getAudioStream('song', null, { video: true });
  expect(result.stream.url).toBe('https://stream.test/18');
  expect(result.stream.dashManifest).toBeUndefined();
});

it('keeps ordinary audio playback on its existing resolution path', async () => {
  const toDash = vi.fn();
  getInfo.mockResolvedValue({ playability_status: { status: 'OK' }, streaming_data: {
    formats: [format(18, 360, 1000000)], adaptive_formats: [format(137, 1080, 4000000)],
  }, toDash });
  expect((await getAudioStream('song')).stream.url).toBe('https://stream.test/18');
  expect(toDash).not.toHaveBeenCalled();
});
