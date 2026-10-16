import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLastfm, lastfmSignature } from './lastfm.mjs';
const credentials = { apiKey: 'synthetic-key', apiSecret: 'synthetic-secret' };
test('signs sorted UTF-8 fields while excluding transport-only parameters', () => {
  const expected = createHash('md5').update('api_keykeyartist宇多田methodtrack.scrobblesecret').digest('hex');
  assert.equal(lastfmSignature({ method: 'track.scrobble', artist: '宇多田', api_key: 'key', format: 'json', callback: 'callback' }, 'secret'), expected);
});
test('exchanges tokens and returns the existing renderer session contract', async () => {
  const requests = [];
  const client = createLastfm({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const response = options.body.get('method') === 'auth.getToken' ? { token: 'approved-token' } : { session: { key: 'session-key', name: 'Listener' } };
    return Response.json(response);
  } });
  const token = await client.getToken(credentials);
  assert.equal(new URL(token.authUrl).searchParams.get('token'), 'approved-token');
  assert.deepEqual(await client.getSession({ ...credentials, token: token.token }), { sessionKey: 'session-key', username: 'Listener' });
  assert.equal(requests[0].url, 'https://ws.audioscrobbler.com/2.0/');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.body.has('apiSecret'), false);
  assert.equal(requests[0].options.body.toString().includes(credentials.apiSecret), false);
});
test('sends now-playing and scrobbles with original timestamps and optional fields', async () => {
  const bodies = [];
  const client = createLastfm({ fetchImpl: async (_url, options) => { bodies.push(options.body); return Response.json({}); } });
  const track = { ...credentials, sessionKey: 'session', artist: 'Artist', track: 'Song', album: '', duration: 183 };
  await client.nowPlaying(track); await client.scrobble({ ...track, timestamp: 1700000000 });
  assert.equal(bodies[0].get('method'), 'track.updateNowPlaying');
  assert.equal(bodies[0].has('album'), false);
  assert.equal(bodies[1].get('timestamp'), '1700000000');
  assert.equal(bodies[1].get('duration'), '183');
  await assert.rejects(client.scrobble({ ...track, timestamp: -1 }), /timestamp/);
});
test('surfaces Last.fm errors and rejects missing sessions or invalid response bodies', async () => {
  await assert.rejects(createLastfm({ fetchImpl: async () => Response.json({ error: 9, message: 'Invalid session key' }) }).getToken(credentials), /Invalid session key \(code 9\)/);
  await assert.rejects(createLastfm({ fetchImpl: async () => Response.json({}) }).getSession({ ...credentials, token: 'token' }), /authorize/);
  await assert.rejects(createLastfm({ fetchImpl: async () => new Response('maintenance', { status: 503 }) }).getToken(credentials), /HTTP 503/);
});
