// A private session bus exercises the same property writes used by KDE.
import assert from 'node:assert/strict';
import Player from '@jellybrick/mpris-service';
import * as dbus from '@jellybrick/dbus-next';
import { createMpris } from './mpris.mjs';

const events = [];
const errors = [];
const name = 'cherry.test.instance' + process.pid;
const service = createMpris({ Player, name,
  dispatch: (event, payload) => {
    events.push([event, payload]);
    if (event === 'media-key://shuffle') service.setModes({ shuffle: payload.shuffle });
    if (event === 'media-key://repeat') service.setModes({ repeat: payload.repeat });
  }, raise: () => events.push(['raise']), quit: () => events.push(['quit']), onError: error => errors.push(error),
});
const client = dbus.sessionBus();
try {
  let object;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { object = await client.getProxyObject('org.mpris.MediaPlayer2.' + name, '/org/mpris/MediaPlayer2'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.ok(object, 'MPRIS service must register');
  const properties = object.getInterface('org.freedesktop.DBus.Properties');
  const iface = 'org.mpris.MediaPlayer2.Player';
  service.update({ trackId: 'test-video', title: 'Test', artist: 'Artist', album: 'Album', artwork: '',
    durationSecs: 120, positionSecs: 10, isPlaying: false, volume: 0.8 });
  for (const shuffle of [true, false, true]) {
    await properties.Set(iface, 'Shuffle', new dbus.Variant('b', shuffle));
    assert.equal((await properties.Get(iface, 'Shuffle')).value, shuffle);
    assert.deepEqual(events.at(-1), ['media-key://shuffle', { shuffle }]);
  }
  for (const [loop, repeat] of [['Playlist', 'all'], ['Track', 'one'], ['None', 'off']]) {
    await properties.Set(iface, 'LoopStatus', new dbus.Variant('s', loop));
    assert.equal((await properties.Get(iface, 'LoopStatus')).value, loop);
    assert.deepEqual(events.at(-1), ['media-key://repeat', { repeat }]);
  }
  const controls = object.getInterface(iface);
  await controls.PlayPause();
  assert.equal(events.at(-1)[0], 'media-key://playpause');
  await controls.Next();
  assert.equal(events.at(-1)[0], 'media-key://next');
  await properties.Set(iface, 'Volume', new dbus.Variant('d', 0.4));
  assert.deepEqual(events.at(-1), ['media-key://volume', { volume: 0.4 }]);
  const metadata = (await properties.Get(iface, 'Metadata')).value;
  assert.equal(metadata['xesam:title'].value, 'Test');
  await controls.SetPosition(metadata['mpris:trackid'].value, 30e6);
  assert.deepEqual(events.at(-1), ['media-key://seek', { positionSecs: 30 }]);
  const count = events.length;
  await controls.SetPosition('/org/mpris/MediaPlayer2/track/stale', 30e6);
  assert.equal(events.length, count, 'ignore stale track scrubber requests');
  await controls.Seek(-5e6);
  assert.deepEqual(events.at(-1), ['media-key://seek-by', { deltaSecs: -5 }]);
  assert.equal((await properties.Get(iface, 'Position')).value.toString(), '10000000');
  service.clear();
  assert.equal((await properties.Get(iface, 'PlaybackStatus')).value, 'Stopped');
  assert.deepEqual(errors, []);
  console.log('MPRIS_SMOKE_PASS');
} finally {
  client.disconnect();
  service.close();
}
