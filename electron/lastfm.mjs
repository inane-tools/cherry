import { createHash } from 'node:crypto';

const API = 'https://ws.audioscrobbler.com/2.0/';
export function lastfmSignature(params, secret) {
  const input = Object.keys(params).filter(key => !['format', 'callback', 'api_sig'].includes(key)).sort().map(key => key + params[key]).join('') + secret;
  return createHash('md5').update(input, 'utf8').digest('hex');
}
function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Missing or invalid Last.fm ' + name);
  return value;
}
export function createLastfm({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  async function call(args, method, extra = {}) {
    const apiKey = required(args.apiKey, 'API key'), secret = required(args.apiSecret, 'API secret');
    const params = { ...extra, api_key: apiKey, method };
    const body = new URLSearchParams({ ...params, api_sig: lastfmSignature(params, secret), format: 'json' });
    // Fixed endpoint; never redirect session keys to another host.
    const response = await fetchImpl(API, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'Cherry Electron (https://inane.tools)' } });
    const chunks = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Last.fm returned an oversized response');
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Last.fm returned an unexpected response (HTTP ' + response.status + ')'); }
    if (result?.error) throw new Error(String(result.message || 'Last.fm rejected the request') + ' (code ' + result.error + ')');
    if (!response.ok) throw new Error('Last.fm request failed (HTTP ' + response.status + ')');
    return result;
  }
  function trackParams(args) {
    const params = { sk: required(args.sessionKey, 'session key'), artist: required(args.artist, 'artist'), track: required(args.track, 'track') };
    if (args.album) params.album = required(args.album, 'album');
    if (Number.isFinite(args.duration) && args.duration > 0) params.duration = String(Math.floor(args.duration));
    return params;
  }
  return {
    async getToken(args) {
      const result = await call(args, 'auth.getToken');
      const token = required(result.token, 'auth token');
      const url = new URL('https://www.last.fm/api/auth/'); url.searchParams.set('api_key', args.apiKey); url.searchParams.set('token', token);
      return { token, authUrl: url.href };
    },
    async getSession(args) {
      const result = await call(args, 'auth.getSession', { token: required(args.token, 'auth token') });
      return { sessionKey: required(result.session?.key, 'session key (authorize the token first)'), username: String(result.session?.name ?? '') };
    },
    async nowPlaying(args) { await call(args, 'track.updateNowPlaying', trackParams(args)); },
    async scrobble(args) {
      if (!Number.isInteger(args.timestamp) || args.timestamp <= 0) throw new Error('Invalid Last.fm scrobble timestamp');
      await call(args, 'track.scrobble', { ...trackParams(args), timestamp: String(args.timestamp) });
    },
  };
}
