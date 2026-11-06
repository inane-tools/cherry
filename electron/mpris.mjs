import { createHash } from 'node:crypto';

const loopModes = { None: 'off', Playlist: 'all', Track: 'one' };
const loopStatuses = { off: 'None', all: 'Playlist', one: 'Track' };
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Own Linux's media interface so writable shuffle/repeat reach the real queue. */
export function createMpris({ Player, name = 'cherry', dispatch, raise, quit, onError = console.warn }) {
  const player = new Player({ name, identity: 'Cherry', desktopEntry: 'tools.inane.cherry.electron',
    supportedInterfaces: ['player'], supportedUriSchemes: [], supportedMimeTypes: [] });
  let position = 0;
  let duration = 0;
  let updatedAt = Date.now();
  let closed = false;
  const currentPosition = () => Math.min(duration, position + (player.playbackStatus === 'Playing' ? (Date.now() - updatedAt) * 1000 : 0));
  player.getPosition = currentPosition;
  player.on('error', error => { onError(error); });
  player.canRaise = true;
  player.canQuit = true;
  player.on('raise', raise);
  player.on('quit', quit);
  for (const [event, action] of Object.entries({ play: 'play', pause: 'pause', playpause: 'playpause', stop: 'stop', next: 'next', previous: 'prev' })) {
    player.on(event, () => dispatch('media-key://' + action));
  }
  player.on('shuffle', value => {
    if (typeof value === 'boolean') dispatch('media-key://shuffle', { shuffle: value });
  });
  player.on('loopStatus', value => {
    if (Object.hasOwn(loopModes, value)) dispatch('media-key://repeat', { repeat: loopModes[value] });
  });
  player.on('volume', value => {
    if (finite(value)) dispatch('media-key://volume', { volume: Math.max(0, Math.min(1, value)) });
  });
  player.on('seek', offset => {
    if (finite(offset)) dispatch('media-key://seek-by', { deltaSecs: offset / 1e6 });
  });
  player.on('position', ({ trackId, position: next }) => {
    if (trackId === player.metadata['mpris:trackid'] && finite(next) && next >= 0 && next <= duration) {
      dispatch('media-key://seek', { positionSecs: next / 1e6 });
    }
  });

  function clear() {
    player.playbackStatus = 'Stopped';
    player.metadata = {};
    position = duration = 0;
    for (const property of ['canPlay', 'canPause', 'canSeek', 'canGoNext', 'canGoPrevious']) player[property] = false;
  }
  clear();
  return {
    update(info) {
      if (closed || !info || typeof info.title !== 'string') return;
      const id = createHash('sha256').update(String(info.trackId || [info.title, info.artist, info.album].join('\n'))).digest('hex');
      const trackId = '/org/mpris/MediaPlayer2/track/' + id;
      const sameTrack = player.metadata['mpris:trackid'] === trackId;
      const before = currentPosition();
      duration = finite(info.durationSecs) ? Math.max(0, info.durationSecs) * 1e6 : 0;
      player.metadata = {
        'mpris:trackid': trackId, 'mpris:length': duration,
        'mpris:artUrl': typeof info.artwork === 'string' ? info.artwork : '',
        'xesam:title': info.title, 'xesam:artist': [String(info.artist || '')], 'xesam:album': String(info.album || ''),
      };
      if (!info.isLoading) {
        position = finite(info.positionSecs) ? Math.max(0, Math.min(duration, info.positionSecs * 1e6)) : 0;
        updatedAt = Date.now();
        player.playbackStatus = info.isPlaying ? 'Playing' : 'Paused';
        if (sameTrack && Math.abs(before - position) > 2e6) player.seeked(position);
      }
      if (finite(info.volume)) player.volume = Math.max(0, Math.min(1, info.volume));
      player.canPlay = player.canPause = player.canGoNext = player.canGoPrevious = true;
      player.canSeek = duration > 0;
    },
    setModes({ shuffle, repeat }) {
      if (typeof shuffle === 'boolean') player.shuffle = shuffle;
      if (Object.hasOwn(loopStatuses, repeat)) player.loopStatus = loopStatuses[repeat];
    },
    clear,
    close() {
      if (closed) return;
      closed = true;
      // The pinned library exposes no public teardown; release its bus connection.
      player._bus?.disconnect();
    },
  };
}
