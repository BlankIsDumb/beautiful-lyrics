import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const load = async entry => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
};
const { NormalizeLyrics, ProjectClassic, DeriveCues, DeriveCueCandidates } = await load('Extension/Source/Modules/LyricDocument.ts');
const { LyricTimeline, LyricTime, TransportTime } = await load('Extension/Source/Modules/LyricTimeline.ts');
const { CreateTimingSettings } = await load('Extension/Source/TimingSettings.ts');
const span = (Text, StartTime, EndTime, IsPartOfWord = false) => ({ Text, StartTime, EndTime, IsPartOfWord });
const voice = (...Syllables) => ({ StartTime: Math.min(...Syllables.map(s => s.StartTime)), EndTime: Math.max(...Syllables.map(s => s.EndTime)), Syllables });
const fixture = () => ({
  Type: 'Syllable', StartTime: 3, EndTime: 22,
  Source: { Provider: 'fixture', TrackId: 'synthetic', CacheKey: 'fixture-1', UniqueTimings: 5, HasWordSync: true,
    Candidates: [{ Provider: 'fixture', TrackId: 'synthetic', UniqueTimings: 5 }], Warnings: ['synthetic warning'] },
  Attribution: { Source: 'fixture', People: [{ Name: 'Synthetic Person', URL: 'https://example.com' }] },
  Content: [
    { Type: 'Vocal', OppositeAligned: true, Lead: voice(span('a', 3, 4, true), span(' b ', 4, 5)),
      Background: [voice(span('back one', 4, 15)), voice(span('back two', 6, 7))] },
    { Type: 'Vocal', OppositeAligned: false, Lead: voice(span('c', 10, 11)) },
    { Type: 'Vocal', OppositeAligned: false, Lead: voice(span('d', 20, 22)) },
  ],
});
const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('immutable normalized document preserves all real voices, text, span provenance and stable IDs', () => {
  const input = fixture();
  const snapshot = structuredClone(input);
  const normalized = NormalizeLyrics(input);
  assert.deepEqual(input, snapshot);
  assert.equal(normalized.groups[0].voices.length, 3);
  assert.equal(normalized.groups[0].voices[2].role, 'backing');
  assert.equal(normalized.groups[0].voices[0].spans[1].Text, ' b ');
  assert.equal(normalized.groups[0].voices[0].spans[0].IsPartOfWord, true);
  assert.equal(normalized.precision, 'word');
  const differentEnvelope = fixture();
  differentEnvelope.Content[0].Lead.StartTime = 2;
  differentEnvelope.Content[0].Lead.EndTime = 6;
  const envelope = NormalizeLyrics(differentEnvelope);
  assert.deepEqual(envelope.groups[0].voices[0].sourceInterval, { start: 2, end: 6 });
  assert.equal(envelope.groups[0].voices[0].start, 3);
  assert.equal(ProjectClassic(envelope).Content.find(row => row.Type === 'Vocal').Lead.StartTime, 2);
  for (const nested of [normalized, normalized.groups, normalized.groups[0], normalized.groups[0].voices[0].spans[0],
    normalized.source.Candidates[0], normalized.source.Warnings, normalized.attribution.People[0]]) assert.equal(Object.isFrozen(nested), true);
  input.Source.Candidates[0].Provider = 'changed';
  input.Attribution.People[0].Name = 'changed';
  assert.equal(normalized.source.Candidates[0].Provider, 'fixture');
  assert.equal(normalized.attribution.People[0].Name, 'Synthetic Person');
  const withLegacyCue = fixture();
  withLegacyCue.Content.unshift({ Type: 'Interlude', StartTime: 0, EndTime: 2.75 });
  const withAnnotation = fixture();
  withAnnotation.Content[0].Lead.Syllables[0].RomanizedText = 'reading';
  assert.deepEqual(NormalizeLyrics(withLegacyCue).groups.map(g => g.id), normalized.groups.map(g => g.id));
  assert.equal(NormalizeLyrics(withAnnotation).groups[0].voices[0].spans[0].id, normalized.groups[0].voices[0].spans[0].id);
  const projected = ProjectClassic(normalized);
  assert.deepEqual(projected.Content.filter(row => row.Type === 'Vocal'), snapshot.Content);
  projected.Attribution.People[0].Name = 'projection mutation';
  assert.equal(normalized.attribution.People[0].Name, 'Synthetic Person');
});

test('fallback document identity follows source text/timing, independent of annotations and cues', () => {
  for (const source of [undefined, { Provider: 'fixture', TrackId: 'synthetic' }]) {
    const input = fixture();
    input.Source = source;
    const id = NormalizeLyrics(input).id;
    const annotation = structuredClone(input);
    annotation.Content[0].Lead.Syllables[0].RomanizedText = 'synthetic reading';
    annotation.Content.unshift({ Type: 'Interlude', StartTime: 0, EndTime: 2.75 });
    assert.equal(NormalizeLyrics(annotation).id, id);
    const text = structuredClone(input);
    text.Content[0].Lead.Syllables[0].Text = 'different synthetic text';
    assert.notEqual(NormalizeLyrics(text).id, id);
    const timing = structuredClone(input);
    timing.Content[0].Lead.Syllables[0].EndTime += .1;
    assert.notEqual(NormalizeLyrics(timing).id, id);
  }
});

test('cue union handles unsorted overlapping and multiple backing voices without cached synthetic events', () => {
  const input = fixture();
  input.Content.reverse();
  input.Content.push({ Type: 'Interlude', StartTime: 11, EndTime: 19 });
  const doc = NormalizeLyrics(input);
  assert.deepEqual(DeriveCues(doc).map(({ start, end }) => [start, end]), [[0, 2.75], [15, 19.75]]);
  assert.equal(ProjectClassic(doc).Content.filter(row => row.Type === 'Interlude').length, 2);
  const separated = fixture();
  separated.Content = [{ Type: 'Vocal', Lead: voice(span('lead', 0, 1)), Background: [voice(span('back', 5, 6))] }];
  assert.deepEqual(DeriveCues(NormalizeLyrics(separated)).map(({ start, end }) => [start, end]), [[1, 4.75]]);
  assert.equal(DeriveCues(NormalizeLyrics({ Type: 'Static', Lines: [{ Text: 'synthetic' }] })).length, 0);
});

test('whole-line syllable wrappers retain line precision and instantaneous spans retain exact zero time', () => {
  const input = fixture();
  input.Source.HasWordSync = false;
  input.Content = [{ Type: 'Vocal', Lead: voice(span('point', 0, 0)) }];
  const normalized = NormalizeLyrics(input);
  assert.equal(normalized.precision, 'line');
  assert.equal(normalized.groups[0].voices[0].spans[0].end, 0);
  assert.equal(ProjectClassic(normalized).Content[0].Lead.EndTime, 0);
  input.Source.HasWordSync = true;
  input.Content.push({ Type: 'Vocal', Lead: voice(span('another whole line', 5, 8)) });
  assert.equal(NormalizeLyrics(input).precision, 'line');
});

test('timeline matches inclusive interval oracle through overlap, point events, gaps, repeated time and seeks', () => {
  const intervals = [{ id: 'a', start: 2, end: 10 }, { id: 'b', start: 4, end: 5 }, { id: 'point', start: 5, end: 5 }, { id: 'zero', start: 0, end: 0 }];
  const timeline = new LyricTimeline(intervals);
  for (const time of [-1, 0, 0, .1, 2, 4, 5, 5, 5.01, 10, 11, 30, 5, -1, 11, 3]) {
    assert.deepEqual([...timeline.evaluate(time).active].sort(), intervals.filter(i => i.start <= time && time <= i.end).map(i => i.id).sort(), `at ${time}`);
  }
  assert.deepEqual([...timeline.evaluate(4.5, true).active].sort(), ['a', 'b']);
});

test('normal timeline frames visit only active/crossed intervals across a large indexed document', () => {
  const timeline = new LyricTimeline(Array.from({ length: 5000 }, (_, n) => ({ id: String(n), start: n * 10, end: n * 10 + 1 })));
  assert.equal(timeline.evaluate(-1).changed.size, 5000); // one mount/seek sweep
  assert.equal(timeline.evaluate(0).changed.size, 1);
  for (let n = 1; n < 60; n++) {
    const state = timeline.evaluate(n / 60);
    assert.equal(state.changed.size, 0);
    assert.deepEqual([...state.active], ['0']);
  }
  assert.equal(timeline.evaluate(2).changed.size, 1);
  assert.equal(timeline.evaluate(3).changed.size, 0);
});

test('signed shared/view offsets invert seek, clamp transport only and persist with scoped notifications', () => {
  assert.equal(LyricTime(0, 1, .5), -1.5);
  assert.equal(LyricTime(10, -1, -.5), 11.5);
  for (const shared of [-2, 0, 2]) for (const view of [-.5, 0, .5]) assert.equal(TransportTime(LyricTime(10, shared, view), shared, view, 100), 10);
  assert.equal(TransportTime(0, -2, 0, 100), 0);
  assert.equal(TransportTime(99, 2, .5, 100), 100);
  const storage = memoryStorage();
  const settings = CreateTimingSettings(storage);
  const events = [];
  const stop = settings.subscribe(scope => events.push(scope));
  settings.save({ Shared: .5, NowPlaying: 1, FullLyrics: 0 });
  settings.save({ Shared: .5, NowPlaying: 1, FullLyrics: 0 });
  assert.deepEqual(events, [['Shared', 'NowPlaying']]);
  assert.equal(CreateTimingSettings(storage).get('NowPlaying'), 1);
  stop();
  settings.save({ Shared: 0, NowPlaying: 1, FullLyrics: -1 });
  assert.deepEqual(events, [['Shared', 'NowPlaying']]);
  assert.equal(settings.get('NowPlaying'), 1);
  const future = CreateTimingSettings({ getItem: () => '{"version":2}', setItem: () => assert.fail('future schema written') });
  assert.equal(future.isReadOnly(), true);
  assert.throws(() => future.save({ Shared: 0, NowPlaying: 0, FullLyrics: 0 }), /newer version/);
  const failed = CreateTimingSettings({ getItem: () => null, setItem: () => { throw Error('quota'); } });
  assert.throws(() => failed.save({ Shared: 1, NowPlaying: 0, FullLyrics: 0 }), /quota/);
  assert.equal(failed.get('Shared'), 0);
});

// Exercise the actual renderer orchestration with narrow host/visual substitutes.
// No Spotify, real storage, source lookups or actual client's DOM is involved.
test('renderer wires indexed work, true spring settling, paused offsets, inverse clicks and disposal', async () => {
  const harness = { visuals: [], cues: [], scrollers: [], pending: new Set() };
  globalThis.__timingHarness = harness;
  class Element {
    classList = { add() {} };
    dataset = {};
    children = [];
    appendChild(child) {this.children.push(child)}
    append(child) {this.children.push(child)}
    remove() {}
  }
  const previous = Object.fromEntries(['document', 'Element', 'MutationObserver', 'ResizeObserver', 'localStorage'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: { createElement: () => new Element() }, Element, MutationObserver: class {}, ResizeObserver: class {}, localStorage: memoryStorage() });
  const visualCode = `export default class Visual {
    calls=[]; frames=0; RequestedTimeSkip={Connect: callback => {this.click=callback}};
    constructor(_parent,metadata){this.text=metadata?.Text;globalThis.__timingHarness.visuals.push(this)}
    SetText(text){this.text=text} SetProjection(runs){this.projection=runs}
    Animate(...args){this.calls.push(args);if(this.frames>0)this.frames--}
    NeedsFrame(){return this.frames>0} Destroy(){this.destroyed=true}
  }`;
  const stubs = {
    'clock-stub': 'export const PlayerLyricClock={};',
    'annotation-stub': 'export const VoiceLanguage=v=>/[ぁ-んァ-ン]/u.test(v.spans.map(s=>s.Text).join(\"\"))?\"Japanese\":undefined;export const AnnotationService={acquire(...args){if(!globalThis.__timingHarness.acquire)throw Error(\"Original must not request annotations\");return globalThis.__timingHarness.acquire(...args)}};',
    'scheduler-stub': `export const IsScheduled=()=>false; export const Cancel=()=>{};
      export function OnPreRender(callback){const set=globalThis.__timingHarness.pending;set.add(callback);return ()=>set.delete(callback)}`,
    'scroller-stub': `export class LyricsScroller {
      forced=[]; ended=[]; constructor(){globalThis.__timingHarness.scrollers.push(this)}
      SetBlurEnabled(){} RefreshCueLayout(){this.cueRefreshes=(this.cueRefreshes||0)+1} SetLyricsEnded(value){this.ended.push(value)} ForceToActive(value){this.forced.push(value)} Destroy(){this.destroyed=true}
    }`,
    'controller-stub': `export class VocalController {
      calls=[];frames=0;renderChanges=0;RequestedTimeSkip={Connect:callback=>{this.click=callback}};
      constructor(parent,document,voice){this.text=voice.spans.map(span=>span.Text).join('');globalThis.__timingHarness.visuals.push(this)}
      SetProjection(runs){this.text=runs.map(run=>run.Text).join('');this.projection=runs}
      SetRendering(profile){this.rendering=profile;this.renderChanges++} RequiresContinuous(){return true}
      Animate(...args){this.calls.push(args);if(this.frames>0)this.frames--}
      NeedsFrame(){return this.frames>0} Destroy(){this.destroyed=true}
    }`,
    'cue-stub':'export class CueController {RequestedTimeSkip={Connect:()=>()=>{}};calls=[];constructor(){globalThis.__timingHarness.cues.push(this)}Animate(){}SetSettings(...args){this.calls.push(args)}NeedsFrame(){return false}RequiresContinuous(){return false}Destroy(){}}',
    'style-stub': '',
  };
  try {
    const result = await build({ stdin: { contents: 'export { default as Renderer } from "./Extension/Source/Modules/LyricsRenderer.ts"; export { TimingSettings } from "./Extension/Source/TimingSettings.ts"; export {PresentationSettings} from "./Extension/Source/PresentationSettings.ts";', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'esm', plugins: [{ name: 'fake-host', setup(build) {
        build.onResolve({ filter: /AnnotationService\.ts$/ }, () => ({ path: 'annotation-stub', namespace: 'stub' }));
        build.onResolve({ filter: /LyricClock\.ts$/ }, () => ({ path: 'clock-stub', namespace: 'stub' }));
        build.onResolve({ filter: /(?:^|[\\/])Scheduler\.ts$/ }, () => ({ path: 'scheduler-stub', namespace: 'stub' }));
        build.onResolve({ filter: /LyricsScroller\.ts$/ }, () => ({ path: 'scroller-stub', namespace: 'stub' }));
        build.onResolve({ filter: /VocalController\.ts$/ }, () => ({path:'controller-stub',namespace:'stub'}));
        build.onResolve({ filter: /CueController\.ts$/ }, () => ({path:'cue-stub',namespace:'stub'}));
        build.onResolve({ filter: /\.scss$/ }, () => ({ path: 'style-stub', namespace: 'stub' }));
        build.onResolve({ filter: /^@Universal\// }, args => ({ path: path.resolve('Universal', args.path.slice('@Universal/'.length)) }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }] });
    const { Renderer, TimingSettings, PresentationSettings } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
    let time = 0;
    const consumers = new Set();
    const seeks = [];
    const clock = { now: () => time, duration: () => 100, seek: t => seeks.push(t), subscribe: fn => { consumers.add(fn); return () => consumers.delete(fn); } };
    const lyrics = { Type: 'Line', NaturalAlignment: 'Left', StartTime: 0, EndTime: 100,
      Content: Array.from({ length: 100 }, (_, n) => ({ Type: 'Vocal', Text: `synthetic ${n}`, StartTime: n, EndTime: n + .8 })) };
    const renderer = new Renderer(new Element(), lyrics, false, 'NowPlaying', clock);
    for (const callback of harness.pending) callback();
    assert.equal(harness.visuals.length, 100);
    assert.equal(harness.visuals.reduce((sum, v) => sum + v.calls.length, 0), 100);
    for (const visual of harness.visuals) visual.calls.length = 0;
    time = .1;
    for (const fn of consumers) fn(.1);
    assert.equal(harness.visuals.reduce((sum, v) => sum + v.calls.length, 0), 1);
    harness.visuals[0].frames = 3;
    time = .9;
    for (const fn of consumers) fn(.1);
    time = .95;
    for (const fn of consumers) fn(.05);
    assert.equal(harness.visuals[0].calls.length, 3); // active, exit, settling
    time = .96;
    for (const fn of consumers) fn(.01);
    time = .97;
    const beforeSleep = harness.visuals[0].calls.length;
    for (const fn of consumers) fn(.01);
    assert.equal(harness.visuals[0].calls.length, beforeSleep);
    const beforeOtherView = harness.visuals[0].calls.length;
    TimingSettings.save({ Shared: 0, NowPlaying: 0, FullLyrics: 1 });
    assert.equal(harness.visuals[0].calls.length, beforeOtherView);
    TimingSettings.save({ Shared: .5, NowPlaying: 1, FullLyrics: 1 });
    assert.equal(harness.visuals[0].calls.length, beforeOtherView + 1);
    assert.equal(harness.visuals[0].calls.at(-1)[0], -.53);
    assert.equal(harness.visuals[0].calls.at(-1)[2], true);
    const beforeCancel = harness.visuals[0].calls.length;
    TimingSettings.save({ Shared: 1, NowPlaying: .5, FullLyrics: 1 });
    assert.equal(harness.visuals[0].calls.length, beforeCancel);
    harness.visuals[2].click();
    assert.equal(seeks.at(-1), 3.5);
    TimingSettings.save({ Shared: -1, NowPlaying: -1, FullLyrics: 1 });
    harness.visuals[0].click();
    assert.equal(seeks.at(-1), 0);
    renderer.Destroy();
    assert.equal(consumers.size, 0);
    assert.equal(harness.pending.size, 0);
    const afterDestroy = harness.visuals[0].calls.length;
    TimingSettings.save({ Shared: 0, NowPlaying: 0, FullLyrics: 0 });
    assert.equal(harness.visuals[0].calls.length, afterDestroy);
    assert.equal(harness.visuals.every(v => v.destroyed), true);
    // Provider part envelopes remain the seek authority; normalized timing
    // envelopes can start later. Static source preferences add no clock lease.
    const envelope={Type:'Syllable',NaturalAlignment:'Left',StartTime:2,EndTime:10,Content:[{Type:'Vocal',Lead:{StartTime:2,EndTime:10,Syllables:[{Text:'one',StartTime:5,EndTime:6,IsPartOfWord:false},{Text:'two',StartTime:7,EndTime:8,IsPartOfWord:false}]}}]};
    const envelopeParent=new Element(),envelopeRenderer=new Renderer(envelopeParent,envelope,false,'NowPlaying',clock);
    TimingSettings.save({Shared:.5,NowPlaying:1,FullLyrics:0});
    harness.visuals.at(-1).click();assert.equal(seeks.at(-1),3.5);
    const lyricsNode=envelopeParent.children.at(-1).children[0];
    assert.equal(lyricsNode.dataset.effectivePrecision,'word');
    PresentationSettings.saveRendering('NowPlaying', 'Word',{...PresentationSettings.getProfile('NowPlaying').renderingCases.Word,detail:'line'});
    assert.equal(lyricsNode.dataset.effectivePrecision,'line');
    const projectedWord=harness.visuals.at(-1),beforeInactive=projectedWord.renderChanges;
    PresentationSettings.saveRendering('NowPlaying','Line',{...PresentationSettings.getRendering('NowPlaying','Line'),glow:true});
    assert.equal(projectedWord.renderChanges,beforeInactive); // Word source stays Word case when displayed as Line.
    const cue=harness.cues.at(-1),cueBefore=cue.calls.length,scroller=harness.scrollers.at(-1),forcedBefore=scroller.forced.length;
    PresentationSettings.saveCues('NowPlaying',{threshold:0,motion:false});
    assert.equal(cue.calls.length,cueBefore+1);assert.equal(projectedWord.renderChanges,beforeInactive);
    assert.equal(scroller.forced.length,forcedBefore);assert.equal(scroller.cueRefreshes,1);
    const otherCueBefore=cue.calls.length;PresentationSettings.saveCues('FullLyrics',{threshold:100,motion:true});assert.equal(cue.calls.length,otherCueBefore);

    envelopeRenderer.Destroy();
    const staticRenderer=new Renderer(new Element(),{Type:'Static',NaturalAlignment:'Left',Lines:[{Text:'plain'}]},false,'NowPlaying',clock);
    assert.equal(consumers.size,0);
    PresentationSettings.saveRendering('NowPlaying', 'Word',{...PresentationSettings.getProfile('NowPlaying').renderingCases.Word,detail:'word',blur:false});
    assert.equal(consumers.size,0);staticRenderer.Destroy();
    TimingSettings.save({Shared:0,NowPlaying:0,FullLyrics:0});
    // Annotation updates keep voice/scroller objects and never force manual scroll.
    const jobs = [];
    harness.acquire = (document, options) => {
      let resolve;
      const promise = new Promise(done => { resolve = done });
      const job = { document, options, resolve, released: false };
      jobs.push(job);
      return { promise, release: () => { job.released = true } };
    };
    const japanese = { Type: 'Line', NaturalAlignment: 'Left', Language: 'jpn', StartTime: 0, EndTime: 5,
      Content: [{ Type: 'Vocal', Text: 'かな', StartTime: 0, EndTime: 5 }] };
    const nowRenderer = new Renderer(new Element(), japanese, false, 'NowPlaying', clock);
    const nowVocal = harness.visuals.at(-1), nowScroller = harness.scrollers.at(-1);
    const fullRenderer = new Renderer(new Element(), japanese, false, 'FullLyrics', clock);
    const fullVocal = harness.visuals.at(-1), fullScroller = harness.scrollers.at(-1);
    for (const callback of harness.pending) callback();
    assert.equal(jobs.length, 0); // Original-only: no converter factory/job.
    const forcedNow = nowScroller.forced.length, forcedFull = fullScroller.forced.length;
    PresentationSettings.setRomanized('NowPlaying', 'Japanese', true);
    assert.equal(jobs.length, 1);
    PresentationSettings.setRomanized('FullLyrics', 'Japanese', true);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].document, jobs[1].document);
    PresentationSettings.saveProfile('NowPlaying', { ...PresentationSettings.getProfile('NowPlaying'), japaneseForm: 'kana' });
    assert.equal(jobs[0].released, true);
    assert.equal(jobs.length, 3);
    const mapped = (job, text) => new Map([[job.document.groups[0].voices[0].id, [{ Text: text }]]]);
    jobs[0].resolve(mapped(jobs[0], 'stale romaji')); await Promise.resolve();
    assert.equal(nowVocal.text, 'かな');
    jobs[1].resolve(mapped(jobs[1], 'full romaji')); jobs[2].resolve(mapped(jobs[2], 'now kana')); await Promise.resolve();
    assert.equal(nowVocal.text, 'now kana'); assert.equal(fullVocal.text, 'full romaji');
    const beforeRender=jobs.length, currentLease=jobs[2];
    PresentationSettings.saveRendering('NowPlaying', 'Word',{...PresentationSettings.getProfile('NowPlaying').renderingCases.Word,highlight:'off',glow:false});
    assert.equal(jobs.length,beforeRender);assert.equal(currentLease.released,false);
    assert.equal(nowVocal.text,'now kana');assert.equal(nowScroller.forced.length,forcedNow);
    assert.equal(PresentationSettings.getProfile('NowPlaying').japaneseForm,'kana');
    const beforeLine=nowVocal.renderChanges;
    PresentationSettings.saveRendering('NowPlaying','Line',{...PresentationSettings.getRendering('NowPlaying','Line'),highlight:'off'});
    assert.equal(nowVocal.renderChanges,beforeLine+1);assert.equal(jobs.length,beforeRender);
    assert.equal(currentLease.released,false);assert.equal(nowVocal.text,'now kana');

    const beforeIrrelevant = jobs.length;
    PresentationSettings.setRomanized('NowPlaying', 'Chinese', true);
    assert.equal(jobs.length, beforeIrrelevant);
    assert.equal(nowVocal.text, 'now kana');
    assert.equal(harness.visuals.includes(nowVocal), true);
    assert.equal(nowScroller.forced.length, forcedNow); assert.equal(fullScroller.forced.length, forcedFull);
    PresentationSettings.saveProfile('NowPlaying', { ...PresentationSettings.getProfile('NowPlaying'), romanizationEnabled: false });
    assert.equal(nowVocal.text, 'かな'); assert.equal(fullVocal.text, 'full romaji');
    PresentationSettings.setRomanized('NowPlaying', 'Japanese', true);
    const pending = jobs.at(-1);
    nowRenderer.Destroy();
    assert.equal(pending.released, true);
    pending.resolve(mapped(pending, 'disposed stale')); await Promise.resolve();
    assert.equal(nowVocal.text, 'かな');
    const replacement = new Renderer(new Element(), { ...japanese, Content: [{ Type: 'Vocal', Text: 'かに', StartTime: 0, EndTime: 5 }] }, false, 'NowPlaying', clock);
    const replacementVocal = harness.visuals.at(-1);
    assert.equal(replacementVocal.text, 'かに');
    replacement.Destroy(); fullRenderer.Destroy();
    assert.equal(consumers.size, 0);

  } finally {
    Object.assign(globalThis, previous);
    delete globalThis.__timingHarness;
  }
});

// Keep the real Classic line animator in this regression: zero-length accepted
// provider lines used to compute 0/0 before writing gradient/glow properties.
test('actual Classic line animator keeps zero-duration states and CSS values finite', async () => {
  const elements = [];
  class Element {
    classes = new Set();
    properties = new Map();
    classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), contains: value => this.classes.has(value) };
    style = { getPropertyValue: key => this.properties.get(key)||"", setProperty: (key, value) => this.properties.set(key, value) };
    appendChild() {} addEventListener() {} removeEventListener() {} remove() {}
  }
  const previous = Object.fromEntries(['document', 'Element', 'MutationObserver', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: { createElement: () => { const element = new Element(); elements.push(element); return element; } }, Element, MutationObserver: class {}, ResizeObserver: class {} });
  try {
    const result = await build({ entryPoints: ['Extension/Source/Modules/LyricsRenderer/Components/LineVocals.ts'], bundle: true, write: false, format: 'esm',
      plugins: [{ name: 'line-host', setup(build) {
        build.onResolve({ filter: /^npm:/ }, args => build.resolve(args.path.slice(4), { resolveDir: process.cwd(), kind: args.kind }));
        build.onResolve({ filter: /(?:^|[\\/])Scheduler\.ts$/ }, () => ({ path: 'scheduler', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const IsScheduled=()=>false;export const Cancel=()=>{};', loader: 'js' }));
        build.onResolve({ filter: /^@(Universal|Spices)\// }, args => {
          const base = args.path.startsWith('@Universal/') ? 'Universal' : 'Extension/Spices';
          return { path: path.resolve(base, args.path.slice(args.path.indexOf('/') + 1)) };
        });
      } }] });
    const { default: Line } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
    const line = new Line(new Element(), { Type: 'Vocal', Text: 'instant synthetic', OppositeAligned: false, StartTime: 5, EndTime: 5 }, false);
    for (const time of [4.9, 5, 5.1, 5, 0, 10]) {
      line.Animate(time, 1 / 60, true);
      assert.equal(line.IsActive(), time === 5);
      for (const element of elements) for (const value of element.properties.values()) assert.doesNotMatch(value, /NaN|Infinity/);
    }
    line.Destroy();
  } finally { Object.assign(globalThis, previous); }
});


test('cue eligibility uses full positive all-voice union gaps, zero Off and literal100 seconds', () => {
  const lyrics={Type:'Syllable',StartTime:0,EndTime:104,Content:[
    {Type:'Vocal',Lead:voice(span('later',102,104))},
    {Type:'Vocal',Lead:voice(span('first',0,1)),Background:[voice(span('backing',.5,1.5)),voice(span('last backing',1,2))]},
  ]};
  const doc=NormalizeLyrics(lyrics),before=JSON.stringify(doc),candidates=DeriveCueCandidates(doc);
  assert.equal(candidates.length,1);assert.equal(candidates[0].gapSeconds,100);
  assert.deepEqual([candidates[0].start,candidates[0].end],[2,101.75]);
  assert.equal(DeriveCues(doc,0).length,0);assert.equal(DeriveCues(doc,100).length,1);assert.equal(DeriveCues(doc,100.1).length,0);
  const tiny=NormalizeLyrics({Type:'Line',StartTime:0,EndTime:2,Content:[{Type:'Vocal',Text:'one',StartTime:0,EndTime:1},{Type:'Vocal',Text:'two',StartTime:1.1,EndTime:2}]});
  const tinyCue=DeriveCues(tiny,.1)[0];assert.ok(tinyCue.end>tinyCue.start);assert.ok(tinyCue.end<1.1);
  const point=NormalizeLyrics({Type:'Line',StartTime:0,EndTime:3,Content:[{Type:'Vocal',Text:'point',StartTime:1,EndTime:1},{Type:'Vocal',Text:'next',StartTime:2,EndTime:3}]});
  assert.deepEqual(DeriveCueCandidates(point).map(cue=>cue.gapSeconds),[1,1]);
  assert.equal(JSON.stringify(doc),before); // Cues never enter immutable/source caches.
});
