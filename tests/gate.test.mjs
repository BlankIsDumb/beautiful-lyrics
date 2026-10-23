import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricRequestGate } from '../Extension/Spices/Spicetify/Services/Player/LyricRequestGate.mjs';

test('first change is immediate, bursts restart 800 ms, and settled autoplay is immediate again', async () => {
  let time = 0, serial = 0;
  const timers = new Map();
  const gate = createLyricRequestGate({ now: () => time,
    schedule: (fn, delay) => { timers.set(++serial, {fn, at: time + delay}); return serial; },
    cancel: id => timers.delete(id),
  });
  const advance = async value => {
    time = value;
    for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); }
    await Promise.resolve();
  };
  assert.equal(await gate.change(), true);
  assert.equal(timers.size, 0);
  await advance(100);
  const displaced = gate.change();
  await advance(700);
  let finished = false;
  const latest = gate.change().then(value => { finished = true; return value; });
  assert.equal(await displaced, false);
  assert.equal(timers.size, 1);
  await advance(1499);
  assert.equal(finished, false);
  await advance(1500);
  assert.equal(await latest, true);
  assert.equal(timers.size, 0);
  await advance(1600);
  assert.equal(await gate.change(), true);
  await advance(1700);
  const disposed = gate.change();
  gate.dispose();
  assert.equal(await disposed, false);
  assert.equal(timers.size, 0);
});
