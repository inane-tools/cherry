import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJumpList, createPlaylistLaunch, playlistArgument, pngIcon, createJumpLists } from './jump-list.mjs';

const pin = { browseId: 'VLPIN', title: 'Pinned', thumbnail: 'https://image.test/pin' };
const recent = { browseId: 'VLRECENT', title: 'Recent' };
test('validates playlist launch arguments without accepting flags or shell fragments', () => {
  assert.equal(playlistArgument(['app', '--play-playlist', 'VLPIN']), 'VLPIN');
  assert.equal(playlistArgument(['app', '--open-playlist', 'VLPIN']), 'VLPIN');
  assert.equal(playlistArgument(['app', '--open-playlist=VLPIN', '--other']), 'VLPIN');
  for (const id of ['', '--devtools', 'abc;quit', '../files', 'id with space', 'a'.repeat(257)]) assert.equal(playlistArgument(['--play-playlist', id]), null);
});
test('queues cold-start playlists and delivers later launches once the renderer listens', () => {
  const dispatched = [];
  const launches = createPlaylistLaunch(['--play-playlist', 'FIRST'], id => dispatched.push(id));
  launches.receive(['--play-playlist', 'LATEST']);
  assert.equal(launches.take(), 'LATEST'); assert.equal(launches.take(), null);
  launches.receive(['--play-playlist', 'NEXT']); assert.deepEqual(dispatched, ['NEXT']);
  launches.reset(); launches.receive(['--play-playlist', 'RELOAD']);
  assert.deepEqual(dispatched, ['NEXT']); assert.equal(launches.take(), 'RELOAD');
});
test('builds pinned/recent sections, honours removed items and deduplicates playlists', () => {
  const lists = buildJumpList({ pinned: [pin], recent: [pin, recent, { browseId: 'REMOVED', title: 'Gone' }], removedItems: [{ args: '"C:\\Apps\\Cherry Electron" --play-playlist REMOVED' }], minItems: 3, executable: 'C:\\Cherry.exe', launchPrefix: ['C:\\App With Spaces'], iconFor: url => url ? 'pin.ico' : 'app.ico' });
  assert.equal(lists.length, 2);
  assert.equal(lists[0].items[0].args, '"C:\\App With Spaces" --open-playlist=VLPIN');
  assert.equal(lists[0].items[0].iconPath, 'pin.ico');
  assert.deepEqual(lists[1].items.map(item => item.title), ['Recent']);
  assert.equal(buildJumpList({ pinned: [pin], recent: [recent], minItems: 1, executable: 'cherry.exe' }).length, 1);
});
test('builds an ICO with a PNG image and correct offsets', () => {
  const png = Buffer.from('synthetic-png'); const icon = pngIcon(png);
  assert.equal(icon.readUInt16LE(2), 1); assert.equal(icon.readUInt16LE(4), 1);
  assert.equal(icon[6], 64); assert.equal(icon.readUInt32LE(14), png.length);
  assert.equal(icon.readUInt32LE(18), 22); assert.deepEqual(icon.subarray(22), png);
});
test('uses the app icon until artwork is cached, and skips native Jump Lists on Linux', async () => {
  let result;
  const app = { isPackaged: true, getJumpListSettings: () => ({ minItems: 10, removedItems: [] }), setJumpList: value => { result = value; return 'ok'; } };
  const lists = createJumpLists({ app, platform: 'win32', directory: '/missing-cache', iconPath: 'cherry.ico' });
  await lists.update([pin], [recent]);
  assert.equal(result[0].items[0].iconPath, 'cherry.ico');
  await assert.rejects(lists.cacheArtwork(pin.thumbnail, 'not png'), /Expected PNG/);
  const linux = createJumpLists({ app: {}, platform: 'linux', directory: '/missing-cache' });
  await linux.update([pin], []); assert.equal(await linux.artworkCached(pin.thumbnail), true);
});
