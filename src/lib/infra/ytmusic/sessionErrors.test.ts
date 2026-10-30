import { beforeEach, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getInnertube, resetInnertubeClient } from './InnertubeClient';
beforeEach(() => { resetInnertubeClient(); create.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

it('does not misreport certificate-authority errors as an expired login', async () => {
  create.mockRejectedValue(new Error('Network request to youtube.com failed: The HTTPS certificate is not trusted (ERR_CERT_AUTHORITY_INVALID)'));
  await expect(getInnertube()).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('ERR_CERT_AUTHORITY_INVALID') });
});

it('allows session creation to recover on a later attempt after a network failure', async () => {
  create.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce({ recovered: true });
  await expect(getInnertube()).rejects.toMatchObject({ code: 'network' });
  await expect(getInnertube()).resolves.toEqual({ recovered: true });
});

it('still distinguishes explicit authentication failures', async () => {
  create.mockRejectedValue(new Error('HTTP 401 Authentication required'));
  await expect(getInnertube()).rejects.toMatchObject({ code: 'auth-invalid' });
});
