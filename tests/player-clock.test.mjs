import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync, transformSync } from 'esbuild';

// Run the production sampler in isolation from Spotify and the lyrics providers.
const source = readFileSync(new URL('../Extension/Spices/Spicetify/Services/Player/mod.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('// Handle position syncing');
const end = source.indexOf('// Handle frame updating', start);
assert.ok(start >= 0 && end > start, 'locate the player position sampler');
const { code } = transformSync(source.slice(start, end) + `
	return {
		request: RequestPositionSync,
		setPlaying: playing => { IsPlaying = playing }
	}
`, { loader: 'ts' });
const createSampler = new Function(
  'SpotifyPlatform', 'IsPlaying', 'performance', 'Date', code,
);

function spotify() {
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
  return { platform, transportCalls };
}

function fixture() {
  const { platform, transportCalls } = spotify();
  const sampler = createSampler(platform, false, { now: () => 400 }, { now: () => 2000 });
  return {
    platform, transportCalls,
    setPlaying: sampler.setPlaying,
    tick: sampler.request,
  };
}

test('a paused track restored during a device handoff never sends Resume', async () => {
  const clock = fixture();
  await clock.tick();
  clock.platform.PlayerAPI._state = null;
  assert.equal(await clock.tick(), undefined);
  clock.platform.PlayerAPI._state = { positionAsOfTimestamp: 12000, timestamp: 1700 };
  assert.deepEqual(await clock.tick(), { Position: 12000 });
  assert.deepEqual(await clock.tick(), { Position: 12000 });
  assert.deepEqual(clock.transportCalls, []);
});

// Use the real Signal so idempotent Disconnect and the Connection identity
// that Maid depends on are part of the demand tests.
const signalModule = { exports: {} };
new Function('module', 'exports', buildSync({
  entryPoints: ['Universal/Modules/Signal.ts'], bundle: true, write: false, format: 'cjs',
}).outputFiles[0].text)(signalModule, signalModule.exports);
const { Signal, IsConnection } = signalModule.exports;
const signals = source.slice(source.indexOf('type TimeStepped ='), source.indexOf('export const SongChanged:'));
const clockEnd = source.lastIndexOf('\n\t\t}\n\t}\n)');
assert.ok(clockEnd > start, 'locate the player clock scheduling block');
const clockBody = source.slice(start, clockEnd);
const createClock = new Function('Signal', 'PlayerMaid', 'SpotifyPlatform', 'SpotifyPlayer', 'performance', 'Date', 'Defer', 'Timeout',
  transformSync(signals + `
    let Timestamp = 0, Song = {}, IsPlaying = false;
    const IsPlayingChanged = IsPlayingChangedSignal.GetEvent();
    ${clockBody}
    return {
      event: TimeSteppedSignal.GetEvent(),
      now: () => Timestamp,
      play(playing) { IsPlaying = playing; IsPlayingChangedSignal.Fire(); }
    };
  `, { loader: 'ts' }).code);

function demandFixture() {
  const { platform, transportCalls } = spotify();
  const tasks = new Map();
  const maid = {
    GiveItems: (...items) => items,
    Give: (item, key) => { if (key) tasks.set(key, item); return item; },
    Clean: key => tasks.delete(key),
  };
  let now = 400;
  const player = { getProgress: () => 31500 };
  const clock = createClock(
    Signal, maid, platform, player, { now: () => now }, { now: () => 2000 },
    callback => ({ callback }), (delay, callback) => ({ delay, callback }),
  );
  const frame = 'Timestep', sync = 'TimestampPositionSync';
  function run(key, elapsed) {
    now += elapsed;
    const { callback } = tasks.get(key);
    tasks.delete(key);
    return callback();
  }
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  return { ...clock, platform, transportCalls, tasks, frame, sync, run, flush, advance: elapsed => { now += elapsed; } };
}

test('demand transitions idle → 10 Hz paused watch → 30 Hz and frames → idle', async () => {
  const clock = demandFixture();
  const { tasks, frame, sync, platform, run, play, flush } = clock;
  const ticks = [];
  play(true);
  play(false);
  assert.equal(tasks.size, 0);
  assert.deepEqual(clock.transportCalls, []);

  const listener = clock.event.Connect((delta, skipped) => ticks.push([clock.now(), delta, skipped]));
  const second = clock.event.Connect(() => {});
  assert.ok(IsConnection(listener));
  assert.equal(clock.now(), 12, 'paused Connect position is seeded before Connect returns');
  await flush();
  assert.equal(tasks.get(sync).delay, .1);
  assert.equal(tasks.has(frame), false);
  assert.deepEqual(ticks, []);
  platform.PlayerAPI._state.positionAsOfTimestamp = 19000;
  await run(sync, 100);
  assert.deepEqual(ticks, [[19, 0, true]]);
  platform.PlayerAPI._state.positionAsOfTimestamp = 19040;
  await run(sync, 100);
  assert.equal(ticks.length, 1, 'paused jitter under the old threshold is ignored');

  clock.advance(30000);
  platform.PlayerAPI._state = { positionAsOfTimestamp: 19000, timestamp: 2000 };
  play(true);
  assert.ok(tasks.has(frame));
  await flush();
  assert.equal(tasks.get(sync).delay, 1 / 30);
  run(frame, 4);
  assert.deepEqual(ticks.at(-1), [19.004, .004, undefined]);
  assert.ok(tasks.has(frame));
  play(false);
  assert.equal(tasks.has(frame), false);
  await flush();
  assert.equal(tasks.get(sync).delay, .1);
  listener.Disconnect();
  listener.Disconnect();
  assert.ok(tasks.has(sync), 'double Disconnect leaves the second subscriber live');
  second.Disconnect();
  assert.equal(tasks.size, 0);
});

test('local seed is synchronous and stale native reads cannot rearm a stopped clock', async () => {
  const clock = demandFixture();
  clock.platform.PlaybackAPI._isLocal = true;
  const pending = [];
  clock.platform.PlayerAPI._contextPlayer.getPositionState = () => new Promise(resolve => pending.push(resolve));
  clock.play(true);
  assert.equal(clock.tasks.size, 0);
  const listener = clock.event.Connect(() => assert.fail('stale read fired a tick'));
  assert.equal(clock.now(), 31.5);
  assert.equal(pending.length, 1);
  assert.ok(clock.tasks.has(clock.frame));
  clock.play(false);
  assert.equal(clock.tasks.has(clock.frame), false);
  assert.equal(pending.length, 2);
  listener.Disconnect();
  for (const resolve of pending) resolve({ position: 89000n });
  await clock.flush();
  assert.equal(clock.tasks.size, 0);
  assert.equal(clock.now(), 31.5);
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
