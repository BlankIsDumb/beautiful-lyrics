import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the production sampler in isolation from Spotify and the lyrics providers.
const source = readFileSync(new URL('../Extension/Spices/Spicetify/Services/Player/mod.ts', import.meta.url), 'utf8');
const start = source.indexOf('// Handle position syncing');
const end = source.indexOf('// Handle frame updating', start);
assert.ok(start >= 0 && end > start, 'locate the player position sampler');
const { code } = transformSync(source.slice(start, end) + `
	return {
		request: RequestPositionSync,
		sample: () => syncedPosition,
		setPlaying: playing => { IsPlaying = playing }
	}
`, { loader: 'ts' });
const createSampler = new Function(
  'SpotifyPlatform', 'IsPlaying', 'SongChangedSignal', 'IsPlayingChangedSignal',
  'PlayerMaid', 'Timeout', 'performance', 'Date', code,
);

function fixture() {
  const transportCalls = [];
  const platform = {
    PlaybackAPI: { _isLocal: false },
    PlayerAPI: {
      _state: { positionAsOfTimestamp: 12000, timestamp: 1700 },
      _contextPlayer: {
        async resume() { transportCalls.push('Resume'); },
        async getPositionState() {
          transportCalls.push('GetPositionState');
          return { position: 38000n };
        },
      },
    },
  };
  const signal = () => {
    const callbacks = [];
    return { Connect: callback => callbacks.push(callback), fire: () => callbacks.forEach(callback => callback()) };
  };
  const songChanged = signal();
  const playChanged = signal();
  const timers = new Map();
  const sampler = createSampler(
    platform, false, songChanged, playChanged,
    { Give: (timer, key) => timers.set(key, timer) },
    (delay, callback) => ({ delay, callback }),
    { now: () => 400 }, { now: () => 2000 },
  );
  let next = sampler.request;

  return {
    platform, transportCalls, songChanged,
    setPlaying(playing) {
      sampler.setPlaying(playing);
      playChanged.fire();
    },
    async tick() {
      await next();
      const timer = timers.get('TimestampPositionSync');
      assert.equal(timer.delay, 1 / 30);
      next = timer.callback;
      timers.clear();
      return sampler.sample();
    },
  };
}

test('a paused track restored during a device handoff never sends Resume', async () => {
  const clock = fixture();
  await clock.tick();
  clock.platform.PlayerAPI._state = null;
  assert.equal(await clock.tick(), undefined);
  clock.platform.PlayerAPI._state = { positionAsOfTimestamp: 12000, timestamp: 1700 };
  clock.songChanged.fire();
  assert.deepEqual(await clock.tick(), { Position: 12000 });
  assert.deepEqual(await clock.tick(), { Position: 12000 });
  assert.deepEqual(clock.transportCalls, []);
});

test('the clock follows Connect snapshots and switches back to native local reads', async () => {
  const clock = fixture();
  clock.setPlaying(true);
  assert.deepEqual(await clock.tick(), { StartedSyncAt: 400, Position: 12300 });
  clock.platform.PlayerAPI._state = { positionAsOfTimestamp: 37000, timestamp: 0 };
  assert.equal(await clock.tick(), undefined);
  clock.platform.PlayerAPI._state.timestamp = 1990;
  assert.deepEqual(await clock.tick(), { StartedSyncAt: 400, Position: 37010 });
  assert.deepEqual(clock.transportCalls, []);
  clock.platform.PlaybackAPI._isLocal = true;
  assert.deepEqual(await clock.tick(), { StartedSyncAt: 400, Position: 38000 });
  assert.deepEqual(clock.transportCalls, ['GetPositionState']);
});
