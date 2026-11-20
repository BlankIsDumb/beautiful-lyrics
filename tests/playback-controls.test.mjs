import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSync, transformSync } from 'esbuild';

const { outputFiles: [bundle] } = buildSync({
  stdin: { contents: `
    export { default as Slider } from './Extension/Source/Components/Slider.ts';
    export { default as TextScroller } from './Extension/Source/Components/TextScroller/mod.ts';
    export { Maid } from './Universal/Modules/Maid.ts';
    export { Signal } from './Universal/Modules/Signal.ts';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', loader: { '.scss': 'empty' },
  alias: { '@Universal': path.resolve('Universal') },
});

function environment() {
  class Element extends EventTarget {
    classes = new Set();
    children = [];
    writes = [];
    classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    style = { setProperty: (...args) => this.writes.push(args) };
    setAttribute() {}
    remove() {}
    querySelector(selector) { return selector === 'span' ? this.firstChild : null; }
    appendChild(child) { this.children.push(child); return child; }
    get firstChild() { return this.children[0]; }
    getBoundingClientRect() { return { width: 200, left: 0 }; }
  }
  class Text {
    writes = [];
    set data(value) { this.writes.push(value); }
    get data() { return this.writes.at(-1); }
  }
  const resizes = new Map(), mutations = new Map();
  const Observer = observers => class {
    constructor(callback) { this.callback = callback; }
    observe(element) { this.element = element; observers.set(element, this.callback); }
    disconnect() { observers.delete(this.element); }
  };
  const frames = new Map(), timers = new Map();
  let now = 0, nextId = 0;
  const requestAnimationFrame = fn => { frames.set(++nextId, fn); return nextId; };
  const cancelAnimationFrame = id => frames.delete(id);
  const setTimeout = (fn, delay) => { timers.set(++nextId, { fn, due: now + delay }); return nextId; };
  const clearTimeout = id => timers.delete(id);
  const document = Object.assign(new EventTarget(), { body: new Element(), createTextNode: () => new Text() });
  const window = Object.assign(new EventTarget(), {
    devicePixelRatio: 1, setTimeout, clearTimeout, cancelAnimationFrame,
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px' }),
  });
  const globals = {
    document, Text, Element, ResizeObserver: Observer(resizes), MutationObserver: Observer(mutations),
    requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout,
    performance: { now: () => now }, globalThis: window,
  };
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(globals), bundle.text)(module, module.exports, ...Object.values(globals));
  const step = (time, queue, consume) => {
    now = time;
    for (const [id, entry] of [...queue]) consume(id, entry);
  };
  return {
    ...module.exports, Element, Text, document, window, frames, timers, mutations,
    resize: (element, width) => resizes.get(element)([{ borderBoxSize: [{ inlineSize: width }], contentRect: { width } }]),
    frame: time => step(time, frames, (id, fn) => { frames.delete(id); fn(time); }),
    timer: time => step(time, timers, (id, entry) => { if (entry.due <= time) { timers.delete(id); entry.fn(); } }),
    mouse: (element, type, clientX) => element.dispatchEvent(Object.assign(new Event(type), { button: 0, clientX })),
  };
}

test('slider gates only CSS writes at half a physical pixel and releases the shared cursor', () => {
  const env = environment(), bar = new env.Element(), volume = new env.Element();
  const slider = new env.Slider(bar, 100, 1, 0, { pixelThreshold: true });
  const other = new env.Slider(volume);
  const values = [];
  slider.ProgressChanged.Connect((...args) => values.push(args));
  slider.SetProgress(10);
  slider.SetProgress(10.1);
  assert.equal(bar.writes.length, 2, 'unknown width writes normally');
  env.window.devicePixelRatio = 2;
  env.resize(bar, 100);
  slider.SetProgress(10.25);
  assert.equal(bar.writes.length, 3);
  assert.equal(slider.GetProgress(), 10.25);
  assert.deepEqual(values.at(-1), [10.25, undefined]);
  slider.SetProgress(10.5);
  assert.equal(bar.writes.length, 4, 'small changes accumulate against the last CSS write');
  slider.SetProgress(10.5, 100);
  slider.SetProgress(10.5, undefined, true);
  assert.equal(bar.writes.length, 6);
  env.resize(bar, 0);
  slider.SetProgress(10.5);
  assert.equal(bar.writes.length, 8, 'resize forces a write and hidden width gates nothing');
  other.SetProgress(.1);
  other.SetProgress(.1);
  assert.equal(volume.writes.length, 2);

  env.mouse(bar, 'mousedown', 41.5);
  env.mouse(volume, 'mousedown', 50);
  assert.equal(slider.IsActive(), true);
  assert.deepEqual(values.at(-1), [20, true], 'user progress keeps step rounding');
  assert.ok(env.document.body.classes.has('JEL-SliderActive'));
  other.Destroy();
  assert.ok(env.document.body.classes.has('JEL-SliderActive'));
  const before = bar.writes.length;
  env.mouse(env.document, 'mouseup', 41.5);
  assert.equal(slider.IsActive(), false);
  assert.equal(bar.writes.length, before + 1, 'drag end force-writes the last position');
  assert.equal(env.document.body.classes.has('JEL-SliderActive'), false);
  env.mouse(bar, 'mousedown', 10);
  slider.Destroy();
  assert.equal(env.document.body.classes.has('JEL-SliderActive'), false);
});

const fullscreen = readFileSync('Extension/Source/LyricViews/Page/Fullscreen.ts', 'utf8');
const player = readFileSync('Extension/Spices/Spicetify/Services/Player/mod.ts', 'utf8');
const clockFormat = player.slice(player.indexOf('export const GetTimestampString'), player.indexOf('// Handle our Details')).replace('export ', '');
const timeline = fullscreen.slice(fullscreen.indexOf('// Handle our timeline'), fullscreen.indexOf('// Handle detail updating (cover-art'));
const createTimeline = new Function('Slider', 'Signal', 'Text', 'document', 'timelineBar', 'timelineTimestamp', 'timelineLength',
  transformSync(`
    let Timestamp = 1.2, Song = { Type: 'Streamed', Duration: 600 };
    const seeks = [], timeStepped = new Signal(), songChanged = new Signal();
    const TimeStepped = timeStepped.GetEvent(), SongChanged = songChanged.GetEvent();
    const SeekTo = time => seeks.push(time), GetDurationString = () => String(Song.Duration);
    ${clockFormat}
    ${timeline}
    return {
      seeks,
      tick(time, skipped, delta = time - Timestamp) { Timestamp = time; timeStepped.Fire(delta, skipped); },
      song(song, time) { Song = song; Timestamp = time; songChanged.Fire(); }
    };
  `, { loader: 'ts' }).code);

test('fullscreen label shares a single text node and cache across clock and drag', () => {
  const env = environment(), maid = new env.Maid();
  const bar = new env.Element(), label = new env.Element(), length = new env.Element();
  const timeline = createTimeline.call({ Maid: maid }, env.Slider, env.Signal, env.Text, env.document, bar, label, length);
  const node = label.firstChild;
  timeline.tick(1.3);
  assert.deepEqual(node.writes, ['00:01']);
  timeline.tick(1.4, true);
  timeline.tick(1.1, undefined, .004);
  timeline.tick(1.6, undefined, .004);
  assert.deepEqual(node.writes, ['00:01', '00:01', '00:01', '00:01']);
  env.resize(bar, 200);
  assert.equal(node.writes.length, 5);
  env.mouse(bar, 'mousedown', 20.1);
  assert.equal(node.data, '01:00');
  timeline.tick(2, true);
  assert.equal(node.writes.length, 6, 'clock never writes while dragging');
  env.mouse(env.document, 'mouseup', 20.1);
  assert.deepEqual(timeline.seeks, [60]);
  assert.equal(node.writes.length, 7);
  timeline.tick(2.3);
  assert.equal(node.writes.length, 7, 'hold until seek acknowledgment');
  timeline.tick(60.03);
  assert.equal(node.writes.length, 8);
  assert.equal(node.data, '01:00');
  timeline.song({ Type: 'DJ' }, 0);
  timeline.tick(7, true);
  env.resize(bar, 0);
  assert.equal(bar.style.display, 'none');
  assert.equal(node.writes.length, 8);
  timeline.song({ Type: 'Streamed', Duration: 300 }, 0);
  assert.equal(node.data, '0:00');
  assert.equal(bar.style.display, '');
  assert.deepEqual(label.children, [node]);
  maid.Destroy();
});

test('text scrollers share one wakeup and sleep through both wait phases', () => {
  const env = environment();
  const makeScroller = () => {
    const element = new env.Element(), text = element.appendChild(new env.Element());
    element.offsetWidth = 100;
    text.offsetWidth = 115;
    const scroller = new env.TextScroller(element, element, true);
    return { element, text, scroller };
  };
  const first = makeScroller(), second = makeScroller();
  assert.equal(env.frames.size + env.timers.size, 0);
  env.resize(first.element, 100);
  env.timer(200);
  env.resize(second.element, 100);
  assert.equal(env.frames.size, 0);
  assert.deepEqual([...env.timers.values()].map(timer => timer.due), [5000]);
  first.scroller.Destroy();
  assert.deepEqual([...env.timers.values()].map(timer => timer.due), [5200]);
  env.timer(4000);
  env.mutations.get(second.text)();
  assert.deepEqual([...env.timers.values()].map(timer => timer.due), [9000]);
  env.timer(9000);
  env.frame(9500);
  assert.ok(Math.abs(parseFloat(second.element.writes.at(-1)[1]) - 7.5) < .0001);
  env.frame(10000);
  assert.equal(second.element.writes.at(-1)[1], '15px');
  env.frame(10004);
  assert.equal(env.frames.size, 0);
  assert.deepEqual([...env.timers.values()].map(timer => timer.due), [12500]);
  env.timer(12500);
  env.frame(13000);
  assert.ok(Math.abs(parseFloat(second.element.writes.at(-1)[1]) - 7.5) < .0001);
  env.frame(13500);
  assert.equal(second.element.writes.at(-1)[1], null);
  assert.deepEqual([...env.timers.values()].map(timer => timer.due), [18500]);
  second.text.offsetWidth = 100;
  env.mutations.get(second.text)();
  assert.equal(env.timers.size, 0);
  second.scroller.Destroy();
  assert.equal(env.frames.size + env.timers.size, 0);
});
