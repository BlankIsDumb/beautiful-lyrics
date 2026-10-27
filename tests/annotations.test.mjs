import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

let serial = 0;
const load = async (entry, stubs = false) => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', plugins: [{ name: 'language-test', setup(b) {
    if (stubs) {
      b.onResolve({ filter: /AnnotationConverters\.ts$/ }, args => args.importer ? ({ path: 'converter', namespace: 'stub' }) : undefined);
      b.onResolve({ filter: /^@|^npm:/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};export const ConvertVoice=()=>{throw Error("unexpected converter")};' }));
    } else b.onResolve({ filter: /^npm:/ }, args => b.resolve(args.path.slice(4).replace(/@[^/@]+$/, ''), { resolveDir: process.cwd(), kind: args.kind }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + `\n// ${serial++}`).toString('base64'));
};
const { NormalizeLyrics } = await load('Extension/Source/Modules/LyricDocument.ts');
const { LayoutVoice, BuildVoiceText, RunProgress } = await load('Extension/Source/Modules/TextLayout.ts');
const { CreateAnnotationService } = await load('Extension/Source/Modules/AnnotationService.ts', true);
const { AlignJapanese } = await load('Extension/Source/Modules/AnnotationConverters.ts', true);
const { TransformProviderLyrics } = await load('Extension/Spices/Spicetify/Services/Player/LyricUtilities.ts');
const span = (Text, StartTime, EndTime, IsPartOfWord = true) => ({ Text, StartTime, EndTime, IsPartOfWord });
const makeDocument = (spans, backing = [], key = 'same-key') => NormalizeLyrics({ Type: 'Syllable', StartTime: 0, EndTime: 20,
  Source: { CacheKey: key, Provider: 'fixture', TrackId: 'synthetic', UniqueTimings: 2, Candidates: [], Warnings: [] },
  Content: [{ Type: 'Vocal', OppositeAligned: false, Lead: { StartTime: 0, EndTime: 20, Syllables: spans },
    Background: backing.map(Syllables => ({ StartTime: 0, EndTime: 20, Syllables })) }] });
const voice = spans => makeDocument(spans).groups[0].voices[0];
const options = { languages: ['Japanese'], japaneseForm: 'romaji' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('source preparation is immutable, non-converting and detects backing-only availability', async () => {
  const source = { Type: 'Syllable', StartTime: 0, EndTime: 4, Content: [{ Type: 'Vocal', Lead: { StartTime: 0, EndTime: 1,
    Syllables: [span('hello', 0, 1, false)] }, Background: [{ StartTime: 1, EndTime: 2, Syllables: [span('かな', 1, 2, false)] },
    { StartTime: 2, EndTime: 4, Syllables: [{ ...span('漢字', 2, 4, false), RomanizedText: 'stale derived' }] }] }] };
  const before = structuredClone(source);
  const prepared = await TransformProviderLyrics(source);
  assert.deepEqual(source, before);
  assert.equal(prepared.RomanizedLanguage, 'Japanese');
  assert.equal(prepared.Content[0].Background[1].Syllables[0].RomanizedText, undefined);
  assert.equal(prepared.Content[0].Background.length, 2);
});

test('current-span word joins, explicit whitespace and cross-span clusters preserve exact mapped source', () => {
  const v = voice([span('one', 0, 1, true), span('two', 1, 2, false), span('three ', 2, 3, false), span(' four', 3, 4, false)]);
  assert.equal(BuildVoiceText(v).text, 'onetwo three  four');
  for (const texts of [['ก', 'ิ', 'ดี'], ['e', '\u0301', 'x'], ['👩', '\u200d', '💻', '!']]) {
    const source = voice(texts.map((text, index) => span(text, index, index + .5, true)));
    const runs = LayoutVoice(source);
    assert.equal(runs.map(run => run.Text).join(''), texts.join(''));
    assert.equal(runs.length, 2);
    assert.equal(runs.flatMap(run => run.SourceRanges).length, texts.length);
    assert.equal(runs[0].Precision, 'grouped');
  }
  const badJoin = LayoutVoice(voice([span('ก', 0, 1, false), span('้', 1, 2, false)]));
  assert.equal(badJoin.length, 1);
  assert.equal(badJoin[0].Text, 'ก้');
});

test('Thai preserves cluster-safe provider granularity; Arabic/Indic coalesce only shaping words', () => {
  const thai = LayoutVoice(voice([span('กิ', 0, 1), span('ดี', 1, 2), span('มาก', 2, 3)]));
  assert.equal(thai.length, 3);
  assert.equal(thai.every(run => !run.SafeLetters && run.Precision === 'source'), true);
  const arabic = LayoutVoice(voice([span('س', 0, 1), span('لام', 1, 2, false), span('عالم', 3, 4, false)]));
  assert.deepEqual(arabic.map(run => run.Text), ['سلام', 'عالم']);
  assert.equal(arabic.every(run => !run.SafeLetters), true);
  const devanagari = LayoutVoice(voice([span('क', 0, 1), span('्', 1, 2), span('ष', 2, 3)]));
  assert.equal(devanagari.length, 1);
  assert.equal(devanagari[0].Text, 'क्ष');
});

test('coalescing preserves final original word flags through explicit whitespace and final-span semantics', () => {
  const source = [span('กิ ', 0, 1, false), span(' ดี', 1, 2, false), span('มาก', 2, 3, false)];
  const snapshot = structuredClone(source);
  const runs = LayoutVoice(voice(source));
  assert.deepEqual(runs.map(run => run.IsPartOfWord), [false, false, false]);
  assert.equal(runs.map(run => run.Text).join(''), source.map(run => run.Text).join(''));
  assert.deepEqual(source, snapshot);
  for (const lastFlag of [false, true]) {
    const merged = LayoutVoice(voice([span('e', 0, 1, false), span('\u0301', 2, 3, lastFlag)]));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].IsPartOfWord, lastFlag);
    assert.equal(merged[0].SourceRanges.length, 2);
    assert.deepEqual(merged[0].Intervals, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  }
});

test('grouped union progress preserves overlap, real gaps and zero-duration events', () => {
  const run = LayoutVoice(voice([span('ก', 0, 1), span('ิ', 3, 4)]))[0];
  assert.deepEqual(run.Intervals, [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
  for (const time of [1, 2, 3]) assert.equal(RunProgress(time, run.Intervals, run.TimingDuration), .5);
  assert.equal(RunProgress(4, run.Intervals, run.TimingDuration), 1);
  const overlap = LayoutVoice(voice([span('e', 0, 2), span('\u0301', 1, 3)]))[0];
  assert.deepEqual(overlap.Intervals, [{ start: 0, end: 3 }]);
  const point = LayoutVoice(voice([span('ก้', 2, 2)]))[0];
  assert.equal(RunProgress(1, point.Intervals, point.TimingDuration), 0);
  assert.equal(RunProgress(2, point.Intervals, point.TimingDuration), 1);
});

test('Japanese sequential mapping clips ranges, preserves punctuation/surrogates/gaps and groups timing honestly', () => {
  const source = voice([span('猫と', 0, 1), span('犬', 3, 4, false), span('😀。', 5, 6, false)]);
  const tokens = [{ surface_form: '猫', reading: 'ネコ', word_position: 99 }, { surface_form: 'と', reading: 'ト', word_position: 1 },
    { surface_form: '犬', reading: 'イヌ' }, { surface_form: ' ' }, { surface_form: '😀' }, { surface_form: '。' }];
  const output = AlignJapanese(source, tokens, 'kana', reading => ({ ネコ: 'ねこ', ト: 'と', イヌ: 'いぬ' })[reading]);
  assert.equal(output.map(run => run.Text).join(''), 'ねこといぬ 😀。');
  assert.deepEqual(output[0].SourceRanges.map(r => [r.start, r.end]), [[0, 1]]);
  assert.deepEqual(output[1].SourceRanges.map(r => [r.start, r.end]), [[1, 2]]);
  assert.equal(output.every(run => run.SourceRanges.length > 0 && run.Precision === 'grouped' && !run.SafeLetters), true);
  const crossing = AlignJapanese(voice([span('漢', 0, 1), span('字', 3, 4)]), [{ surface_form: '漢字', reading: 'カンジ' }], 'romaji', () => 'kanji');
  assert.equal(crossing[0].SourceRanges.length, 2);
  assert.equal(RunProgress(2, crossing[0].Intervals, crossing[0].TimingDuration), .5);
  assert.throws(() => AlignJapanese(source, [{ surface_form: 'missing' }], 'romaji', () => ''), /alignment/);
  const mixed = voice([span('かなe\u0301👩\u200d💻', 0, 3)]);
  assert.throws(() => AlignJapanese(mixed, [{ surface_form: 'かな', reading: 'カナ' }, { surface_form: 'e' }, { surface_form: '\u0301' }, { surface_form: '👩\u200d💻' }], 'kana', () => 'かな'), /cluster/);
});

test('shared leases deduplicate; last release cancels queued voices and cancelled microtasks do zero jobs', async () => {
  let calls = 0;
  const gate = deferred();
  let runningSignal;
  const service = CreateAnnotationService(async (v, _language, _options, signal) => { calls++; runningSignal = signal; await gate.promise; return LayoutVoice(v); });
  const document = makeDocument([span('かな', 0, 1)], [[span('かに', 1, 2)], [span('ねこ', 2, 3)]]);
  const first = service.acquire(document, options, 'jpn');
  const second = service.acquire(document, options, 'jpn');
  await tick();
  assert.equal(calls, 1);
  first.release();
  assert.equal(runningSignal.aborted, false);
  second.release();
  assert.equal(runningSignal.aborted, true);
  gate.resolve(); await second.promise;
  assert.equal(calls, 1);
  const immediate = service.acquire(document, options, 'jpn'); immediate.release(); await immediate.promise;
  assert.equal(calls, 1);
});

test('an old cancelled completion cannot evict a replacement job under the same content key', async () => {
  const gates = [deferred(), deferred()];
  let calls = 0;
  const service = CreateAnnotationService(async v => { const index = calls++; await gates[index].promise; return LayoutVoice(v); });
  const document = makeDocument([span('かな', 0, 1)]);
  const old = service.acquire(document, options, 'jpn'); await tick(); old.release();
  const replacement = service.acquire(document, options, 'jpn'); await tick();
  gates[0].resolve(); await old.promise;
  const shared = service.acquire(document, options, 'jpn');
  assert.equal(calls, 2);
  gates[1].resolve(); await replacement.promise; await shared.promise;
  replacement.release(); shared.release();
});

test('all backing voices convert, actual content/identity/options keys differ, failures retry and cache is bounded', async () => {
  let calls = 0, fail = true;
  const service = CreateAnnotationService(async (v, _language, opts) => {
    calls++; if (fail) throw Error('temporary converter failure');
    return LayoutVoice(v).map(run => ({ ...run, Text: opts.japaneseForm + ':' + run.Text }));
  }, 1);
  const document = makeDocument([span('かな', 0, 1)], [[span('かに', 1, 2)], [span('ねこ', 2, 3)]]);
  let lease = service.acquire(document, options, 'jpn');
  const original = await lease.promise; lease.release();
  assert.equal(original.size, 3);
  assert.equal(original.get(document.groups[0].voices[2].id)[0].Text, 'ねこ');
  fail = false;
  lease = service.acquire(document, options, 'jpn'); const converted = await lease.promise; lease.release();
  assert.equal(calls, 6);
  assert.equal(converted.get(document.groups[0].voices[2].id)[0].Text, 'romaji:ねこ');
  lease = service.acquire(document, options, 'jpn'); await lease.promise; lease.release(); assert.equal(calls, 6);
  const changed = makeDocument([span('かさ', 0, 1)]); // same CacheKey, different actual source
  lease = service.acquire(changed, options, 'jpn'); await lease.promise; lease.release(); assert.equal(calls, 7);
  lease = service.acquire(document, options, 'jpn'); await lease.promise; lease.release(); assert.equal(calls, 10); // old LRU evicted
  lease = service.acquire(document, { ...options, japaneseForm: 'kana' }, 'jpn'); await lease.promise; lease.release(); assert.equal(calls, 13);
  const otherId = makeDocument([span('かな', 0, 1)], [], 'other-key');
  lease = service.acquire(otherId, options, 'jpn'); const rebound = await lease.promise; lease.release();
  assert.equal(rebound.has(otherId.groups[0].voices[0].id), true);
});

test('real local Japanese tokenizer readings align across punctuation and emoji without word_position reliance', async () => {
  const { default: kuromoji } = await import('kuromoji');
  const imported = await import('@sglkc/kuroshiro');
  const Kuroshiro = imported.default.default || imported.default;
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: path.resolve('node_modules/kuromoji/dict') }).build((error, result) => error ? reject(error) : resolve(result)));
  const source = voice([span('私は', 0, 1), span('猫です。', 1, 2, false), span('😀', 3, 4, false)]);
  const tokens = tokenizer.tokenize(BuildVoiceText(source).text);
  const kana = AlignJapanese(source, tokens, 'kana', reading => Kuroshiro.Util.kanaToHiragna(reading));
  const romaji = AlignJapanese(source, tokens, 'romaji', reading => Kuroshiro.Util.kanaToRomaji(reading, 'hepburn'));
  assert.match(kana.map(run => run.Text).join(''), /わたし.*ねこ/u);
  assert.match(romaji.map(run => run.Text).join(''), /watashi.*neko/u);
  assert.equal(kana.map(run => run.Text).join('').includes('😀'), true);
});

test('effective options deduplicate absent languages and irrelevant Japanese form', async () => {
  let calls = 0;
  const service = CreateAnnotationService(async v => { calls++; return LayoutVoice(v); });
  const japanese = makeDocument([span('かな', 0, 1)]);
  let lease = service.acquire(japanese, options, 'jpn'); await lease.promise; lease.release();
  lease = service.acquire(japanese, { ...options, languages: ['Japanese', 'Chinese'] }, 'jpn'); await lease.promise; lease.release();
  assert.equal(calls, 1);
  const korean = makeDocument([span('안녕', 0, 1)]);
  lease = service.acquire(korean, { languages: ['Korean'], japaneseForm: 'romaji' }, 'kor'); await lease.promise; lease.release();
  lease = service.acquire(korean, { languages: ['Korean', 'Japanese'], japaneseForm: 'kana' }, 'kor'); await lease.promise; lease.release();
  assert.equal(calls, 2);
});
