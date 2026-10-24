import { createHash } from 'node:crypto';
const ORIGIN = 'https://music.youtube.com';
const START_URL = ORIGIN + '/playlist_image_upload/playlist_custom_thumbnail';

export function uploadAuthorization(cookie, now) {
  const cookies = new Map(cookie.split(';').map(part => { const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1).trim().replace(/^"|"$/g, '')]; }));
  const signing = cookies.get('SAPISID') || cookies.get('__Secure-3PAPISID') || cookies.get('__Secure-1PAPISID');
  if (!signing) throw new Error('The session has no signing cookie for the playlist image upload');
  return `SAPISIDHASH ${now}_${createHash('sha1').update(`${now} ${signing} ${ORIGIN}`).digest('hex')}`;
}
function sessionUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['music.youtube.com', 'www.youtube.com', 'upload.youtube.com'].includes(url.hostname)) throw new Error('Refused playlist upload destination');
  return url.href;
}
async function responseText(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Playlist upload response is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createPlaylistImageUpload({ fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), userAgent = () => 'Cherry Electron' } = {}) {
  return async ({ cookie, dataBase64, mime, accountIndex = 0, channelId = '', playlistId = '', clientVersion = '', visitorData = '' }) => {
    if (typeof cookie !== 'string' || cookie.length > 100000 || typeof dataBase64 !== 'string' || dataBase64.length > 20 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(mime)) throw new Error('Invalid playlist image');
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || (channelId && (typeof channelId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(channelId)))) throw new Error('Invalid playlist upload account');
    if (typeof playlistId !== 'string' || (playlistId && !/^[a-zA-Z0-9_-]{1,256}$/.test(playlistId))) throw new Error('Invalid playlist upload target');
    if ([clientVersion, visitorData].some(value => typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value))) throw new Error('Invalid playlist upload client');
    const bytes = Buffer.from(dataBase64, 'base64');
    if (!bytes.length || (mime === 'image/jpeg' ? !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw new Error('Invalid playlist image data');
    const headers = { authorization: uploadAuthorization(cookie, now()), cookie, origin: ORIGIN, 'x-origin': ORIGIN,
      referer: playlistId ? ORIGIN + '/playlist?list=' + encodeURIComponent(playlistId.replace(/^VL/, '')) : ORIGIN + '/',
      'x-goog-authuser': String(accountIndex), 'x-youtube-bootstrap-logged-in': 'true', 'user-agent': userAgent() };
    if (clientVersion) {
      headers['x-youtube-client-name'] = '67';
      headers['x-youtube-client-version'] = clientVersion;
      headers['x-goog-api-format-version'] = '1';
    }
    if (visitorData) headers['x-goog-visitor-id'] = visitorData;
    if (channelId) headers['x-goog-pageid'] = channelId;
    const start = await fetchImpl(START_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start', 'x-goog-upload-header-content-length': String(bytes.length), 'x-goog-upload-header-content-type': mime },
      body: new URLSearchParams({ filename: 'cherry-playlist.' + (mime === 'image/png' ? 'png' : 'jpg') }).toString(),
    });
    const destination = start.headers.get('x-goog-upload-url');
    await responseText(start);
    if (!start.ok || !destination) throw new Error(uploadFailure('start', start.status));
    const finish = await fetchImpl(sessionUrl(destination), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { ...headers, 'content-type': 'application/octet-stream', 'x-goog-upload-command': 'upload, finalize', 'x-goog-upload-offset': '0' }, body: bytes,
    });
    const text = await responseText(finish);
    if (!finish.ok) throw new Error(uploadFailure('finish', finish.status));
    let result;
    try { result = JSON.parse(text.replace(/^\)\]\}'\s*/, '')); } catch { throw new Error('Unexpected playlist image upload response'); }
    if (typeof result?.encryptedBlobId !== 'string' || !result.encryptedBlobId || result.encryptedBlobId.length > 16384) throw new Error('Playlist image upload did not return an image ID');
    return result.encryptedBlobId;
  };
}

function uploadFailure(stage, status) {
  const message = 'YouTube Music refused to ' + stage + ' the playlist cover upload (HTTP ' + status + ').';
  return status === 401 || status === 403
    ? message + ' Sign in again with the account that owns this playlist and select its brand account before retrying.'
    : message;
}
