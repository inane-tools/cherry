import { resolve, sep } from 'node:path';

const hosts = ['youtube.com', 'youtu.be', 'youtubei.googleapis.com', 'googleapis.com', 'google.com', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'googleusercontent.com', 'gstatic.com', 'lrclib.net', 'ws.audioscrobbler.com'];
export function allowedRequest(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Refused network destination');
  return url;
}
export function mediaRequest(value) {
  const url = allowedRequest(value);
  if (url.hostname !== 'googlevideo.com' && !url.hostname.endsWith('.googlevideo.com')) throw new Error('Refused media destination');
  return url;
}
export function assetPath(root, pathname) {
  if (decodeURIComponent(pathname).includes('\\')) throw new Error('Refused asset separator');
  const file = resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(resolve(root) + sep)) throw new Error('Refused asset path');
  return file;
}
export function trustedRenderer(frameUrl, devUrl) {
  try {
    const url = new URL(frameUrl);
    return devUrl ? url.origin === new URL(devUrl).origin : url.protocol === 'cherry:' && url.host === 'app';
  } catch { return false; }
}
/** Only the app's main frame may enter user-initiated HTML video fullscreen. */
export function fullscreenPermission(permission, details, frameUrl, devUrl) {
  return permission === 'fullscreen' && details?.isMainFrame === true
    && trustedRenderer(details.requestingUrl, devUrl) && trustedRenderer(frameUrl, devUrl);
}
export function externalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS external links are supported');
  return url.href;
}
