import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, transformSync } from 'esbuild';
import { compareCandidates, hasWordTiming } from '../Extension/Spices/Spicetify/Services/Player/ProviderFormats.mjs';
import { runFocusedFixture } from './chromium-focus-harness.mjs';
import { buildVocalFixture } from './renderer-fixture.mjs';

const module = await build({ stdin: { contents: `
  export * from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts';
  export * from './Extension/Source/Modules/RichSyncCompensation.ts';
  export {NormalizeLyrics,DeriveCueCandidates} from './Extension/Source/Modules/LyricDocument.ts';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm' });
const { GetRichSyncSettings, SaveRichSyncSetting, OnRichSyncSettingsChanged, OnProviderSettingsChanged,
  OnBehaviorSettingsChanged, SelectCompensatedLyrics, NormalizeLyrics, DeriveCueCandidates } = await import(
  'data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].text).toString('base64'));

const defaults = { holdSeconds: 5, minimumSegmentsPerLine: 2, holdWordSync: true };
function rich(provider, count, rows) {
  return {
    Type: 'Syllable', StartTime: rows[0][0], EndTime: rows.at(-1)[1], NaturalAlignment: 'Left',
    Source: { Provider: provider, TrackId: 'fixture', CacheKey: provider, UniqueTimings: count, HasWordSync: true, Candidates: [], Warnings: [] },
    Content: rows.map(([start, end, starts]) => ({ Type: 'Vocal', Lead: {
      StartTime: start, EndTime: end,
      Syllables: starts.map((time, index) => ({ Text: 'word', StartTime: time, EndTime: starts[index + 1] ?? end, IsPartOfWord: false })),
    } })),
  };
}
const rows = [[2, 3, [2, 2.5]], [6, 7, [6]], [12, 13, [12]], [19, 20, [19]]];
const providers = ['Musixmatch', 'LRCLIB', 'Spotify', 'AMLL', 'Spicy'];
const eligible = provider => ['Musixmatch', 'LRCLIB', 'Spotify'].includes(provider);
const denseRows = [[2, 3, [2, 2.5]], [6, 7, [6, 6.5]]];
function song(provider, shape, timing = rows) {
  const lyrics = rich(provider, timing.reduce((sum, row) => sum + row[2].length, 0), timing);
  if (shape === 'Static') return { Type: 'Static', NaturalAlignment: 'Left', Source: { ...lyrics.Source, HasWordSync: false }, Lines: [{ Text: 'static words' }] };
  if (shape === 'Line') {
    lyrics.Type = 'Line';
    lyrics.Content = timing.map(([start, end]) => ({ Type: 'Vocal', Text: 'whole line', StartTime: start, EndTime: end }));
  } else if (shape === 'wrapper') {
    for (const row of lyrics.Content) row.Lead.Syllables = [{ Text: 'whole line', StartTime: row.Lead.StartTime, EndTime: row.Lead.EndTime }];
  }
  lyrics.Source.HasWordSync = hasWordTiming(lyrics);
  return lyrics;
}

// Cross every source shape/setting boundary with provider and selection mode.
// Controls must return the original object, not merely equivalent metadata.
const scenarios = [
  { name: 'line with small gap', shape: 'Line', held: true },
  { name: 'whole-line wrapper with small gap', shape: 'wrapper', held: true },
  { name: 'line with exact cutoff', shape: 'Line', timing: [[2, 3.7, [2]], [8.7, 10, [8.7]]] },
  { name: 'line above cutoff', shape: 'Line', timing: [[2, 3, [2]], [9, 10, [9]]] },
  { name: 'rich at minimum passes', shape: 'rich', timing: denseRows, wordHeld: true },
  { name: 'rich above minimum passes', shape: 'rich', timing: denseRows, settings: { ...defaults, minimumSegmentsPerLine: 1.5 }, wordHeld: true },
  { name: 'rich below minimum becomes held Line', shape: 'rich', held: true, converted: true },
  { name: 'failed rich with exact cutoff', shape: 'rich', timing: [[2, 3.7, [2, 3]], [8.7, 10, [8.7]]], converted: true },
  { name: 'failed rich above cutoff', shape: 'rich', timing: [[2, 3, [2, 2.5]], [9, 10, [9]]], converted: true },
  { name: 'failed rich with only intro silence', shape: 'rich', timing: [[2, 3, [2, 2.5]]], settings: { ...defaults, minimumSegmentsPerLine: 3 }, converted: true },
  { name: 'hold zero still converts rich', shape: 'rich', settings: { ...defaults, holdSeconds: 0 }, converted: true },
  { name: 'hold zero disables passing rich hold', shape: 'rich', timing: denseRows, settings: { ...defaults, holdSeconds: 0 } },
  { name: 'hold zero disables line hold', shape: 'Line', settings: { ...defaults, holdSeconds: 0 } },
  { name: 'hold zero disables wrapper hold', shape: 'wrapper', settings: { ...defaults, holdSeconds: 0 } },
  { name: 'minimum zero keeps word precision', shape: 'rich', settings: { ...defaults, minimumSegmentsPerLine: 0 }, wordHeld: true },
  { name: 'minimum zero still holds line', shape: 'Line', settings: { ...defaults, minimumSegmentsPerLine: 0 }, held: true },
  { name: 'minimum zero still holds wrapper', shape: 'wrapper', settings: { ...defaults, minimumSegmentsPerLine: 0 }, held: true },
  { name: 'both zero keep rich literal', shape: 'rich', settings: { holdSeconds: 0, minimumSegmentsPerLine: 0 } },
  { name: 'both zero keep line literal', shape: 'Line', settings: { holdSeconds: 0, minimumSegmentsPerLine: 0 } },
  { name: 'static stays literal', shape: 'Static' },
];
for (const provider of providers) for (const pinned of [false, true]) for (const holdWordSync of [false, true]) for (const scenario of scenarios) {
  test(`${provider} ${pinned ? 'pinned' : 'Auto'} word hold ${holdWordSync}: ${scenario.name}`, () => {
    const input = song(provider, scenario.shape, scenario.timing);
    const before = JSON.stringify(input);
    const settings = { ...(scenario.settings || defaults), holdWordSync };
    const selected = SelectCompensatedLyrics([input], settings, pinned ? provider : undefined);
    const held = eligible(provider) && !!(scenario.held || holdWordSync && scenario.wordHeld);
    const converted = eligible(provider) && !!scenario.converted;
    assert.equal(selected.Source.RichSyncHoldSeconds, held ? settings.holdSeconds : undefined);
    assert.equal(selected.Source.HasWordSync, converted ? false : input.Source.HasWordSync);
    assert.equal(NormalizeLyrics(selected).precision, scenario.shape === 'Static' ? 'static' : converted || !input.Source.HasWordSync ? 'line' : 'word');
    assert.equal(JSON.stringify(input), before, 'raw provider metadata, timings and cache key stay untouched');
    assert.equal(selected.Content, input.Content, 'projection shares the unchanged timing data');
    if (!held && !converted) assert.equal(selected, input);
    else {
      assert.notEqual(selected, input);
      assert.equal(SelectCompensatedLyrics([input], settings, pinned ? provider : undefined), selected, 'same object/settings reuse the projection');
    }
    assert.deepEqual(DeriveCueCandidates(NormalizeLyrics(selected)), DeriveCueCandidates(NormalizeLyrics(input)), 'projection preserves cue candidates, including unheld gaps');
  });
}

test('compensation settings keep independent zero values and publish only after a successful write', () => {
  const storage = new Map([['BeautifulLyricsLocal/Behavior', '{"sidebarEnabled":false}']]);
  let fail = false, changes = 0, otherEvents = 0;
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => storage.get(key), setItem(key, value) {
    if (fail) throw Error('storage failure');
    storage.set(key, value);
  } };
  const cleanup = [OnRichSyncSettingsChanged(() => changes++), OnProviderSettingsChanged(() => otherEvents++), OnBehaviorSettingsChanged(() => otherEvents++)];
  try {
    assert.deepEqual(GetRichSyncSettings(), defaults);
    assert.equal(storage.size, 1);
    SaveRichSyncSetting('holdSeconds', 0);
    SaveRichSyncSetting('minimumSegmentsPerLine', 0);
    SaveRichSyncSetting('minimumSegmentsPerLine', -1);
    assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 0, minimumSegmentsPerLine: 0, holdWordSync: true });
    fail = true;
    assert.throws(() => SaveRichSyncSetting('holdSeconds', 5), /storage failure/);
    assert.equal(GetRichSyncSettings().holdSeconds, 0);
    assert.equal(changes, 2);
    assert.equal(otherEvents, 0);
  } finally {
    cleanup.forEach(dispose => dispose());
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('word-hold settings default safely, persist independently and publish only after a successful write', () => {
  const previous = globalThis.localStorage;
  const key = 'BeautifulLyricsLocal/RichSyncCompensation';
  const storage = new Map([['BeautifulLyricsLocal/Behavior', '{"sidebarEnabled":false}'], ['BeautifulLyricsLocal/SpicyToken', 'preserve me']]);
  let fail = false, changes = 0, otherEvents = 0;
  globalThis.localStorage = { getItem: key => storage.get(key), setItem(key, value) {
    if (fail) throw Error('storage failure');
    storage.set(key, value);
  } };
  const cleanup = [OnRichSyncSettingsChanged(() => {
    changes++;
    assert.deepEqual(JSON.parse(storage.get(key)), GetRichSyncSettings(), 'event observes the persisted record');
  }), OnProviderSettingsChanged(() => otherEvents++), OnBehaviorSettingsChanged(() => otherEvents++)];
  try {
    for (const invalid of [undefined, null, 0, 1, 'false', 'true', [], {}]) {
      storage.set(key, JSON.stringify({ holdSeconds: 3.25, minimumSegmentsPerLine: 3, holdWordSync: invalid }));
      assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 3.25, minimumSegmentsPerLine: 3, holdWordSync: true });
    }
    storage.set(key, '{broken');
    assert.deepEqual(GetRichSyncSettings(), defaults);
    storage.set(key, JSON.stringify({ holdSeconds: 3.25, minimumSegmentsPerLine: 3 }));
    SaveRichSyncSetting('holdWordSync', false);
    assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 3.25, minimumSegmentsPerLine: 3, holdWordSync: false });
    assert.equal(JSON.parse(storage.get(key)).holdWordSync, false);
    SaveRichSyncSetting('holdWordSync', false);
    for (const invalid of [0, 1, null, 'false', undefined]) SaveRichSyncSetting('holdWordSync', invalid);
    for (const field of ['holdSeconds', 'minimumSegmentsPerLine']) for (const invalid of [true, false, '4', NaN, Infinity, -1]) SaveRichSyncSetting(field, invalid);
    assert.equal(changes, 1, 'invalid types and unchanged values do not write or notify');
    SaveRichSyncSetting('holdSeconds', 0);
    SaveRichSyncSetting('minimumSegmentsPerLine', 0);
    assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 0, minimumSegmentsPerLine: 0, holdWordSync: false });
    fail = true;
    assert.throws(() => SaveRichSyncSetting('holdWordSync', true), /storage failure/);
    assert.equal(GetRichSyncSettings().holdWordSync, false);
    assert.equal(changes, 3);
    fail = false;
    SaveRichSyncSetting('holdWordSync', true);
    assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 0, minimumSegmentsPerLine: 0, holdWordSync: true });
    assert.equal(changes, 4);
    assert.equal(otherEvents, 0);
    assert.equal(storage.get('BeautifulLyricsLocal/Behavior'), '{"sidebarEnabled":false}');
    assert.equal(storage.get('BeautifulLyricsLocal/SpicyToken'), 'preserve me');
  } finally {
    cleanup.forEach(dispose => dispose());
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('hold only breaks Auto ties with eligible Word sources; Line fallback follows the selected provider', () => {
  const mm = rich('Musixmatch', 5, rows);
  const snapshot = JSON.stringify(mm);
  const spicy = rich('Spicy', 5, rows);
  const less = rich('AMLL', 4, rows);
  const line = rich('Spotify', 5, rows);
  line.Source.HasWordSync = false;
  assert.equal(SelectCompensatedLyrics([mm, spicy], defaults), spicy);
  const selected = SelectCompensatedLyrics([mm, less, line], defaults);
  assert.equal(selected.Source.Provider, 'Musixmatch');
  assert.equal(selected.Source.RichSyncHoldSeconds, 5);
  assert.equal(NormalizeLyrics(selected).precision, 'line');
  assert.equal(selected.Content, mm.Content);
  assert.equal(SelectCompensatedLyrics([mm, spicy], defaults, 'Musixmatch'), selected);
  assert.equal(SelectCompensatedLyrics([spicy, mm], defaults), spicy);
  assert.equal(SelectCompensatedLyrics([mm, spicy], { ...defaults, holdSeconds: 0 }).Source.HasWordSync, false);
  assert.equal(SelectCompensatedLyrics([mm, spicy], { holdSeconds: 0, minimumSegmentsPerLine: 0 }), mm);
  assert.equal(SelectCompensatedLyrics([mm], { holdSeconds: 0, minimumSegmentsPerLine: 1.25 }), mm, 'exact ratio passes');
  assert.equal(JSON.stringify(mm), snapshot);
});

test('hold gate uses internal all-voice silence and excludes the exact cutoff', () => {
  const mm = rich('Musixmatch', 3, [[2, 3.7, [2, 3]], [8.7, 10, [8.7]]]);
  const other = rich('Spicy', 3, rows);
  const settings = defaults;
  const exact = SelectCompensatedLyrics([mm, other], settings);
  assert.equal(exact.Source.HasWordSync, false, 'failed rich still converts at the exact gap cutoff');
  assert.equal(exact.Source.RichSyncHoldSeconds, undefined, 'intro and exact five-second gaps stay on ordinary cue rules');
  assert.equal(SelectCompensatedLyrics([mm, other], { ...settings, holdSeconds: 5.001 }), other);
  mm.Content[0].Background = [{ StartTime: 3.2, EndTime: 9, Syllables: [{ Text: 'backing', StartTime: 3.2, EndTime: 9 }] }];
  const withBacking = structuredClone(mm); // a fresh provider result
  const covered = SelectCompensatedLyrics([withBacking, other], { holdSeconds: 10, minimumSegmentsPerLine: 10 });
  assert.equal(covered.Source.RichSyncHoldSeconds, undefined, 'overlapping backing vocals leave no internal silence');
});

for (const provider of providers) for (const pinned of [false, true]) for (const holdWordSync of [false, true]) {
  test(`${provider} ${pinned ? 'pinned' : 'Auto'} word hold ${holdWordSync}: yield only for held sources to another provider with enough word timings`, () => {
    const settings = { ...defaults, holdWordSync };
    for (const shape of ['Line', 'wrapper', 'rich']) for (const passing of [false, true]) for (const delta of [-1, 0, 1]) {
      const input = song(provider, shape, passing ? denseRows : rows);
      const otherProvider = provider === 'Musixmatch' ? 'Spicy' : 'Musixmatch';
      const other = rich(otherProvider, input.Source.UniqueTimings + delta, denseRows);
      const sameProvider = rich(provider, input.Source.UniqueTimings + 10, denseRows);
      const lineAlternative = song(otherProvider, 'Line');
      lineAlternative.Source.UniqueTimings = input.Source.UniqueTimings + 10;
      const ranked = [input, sameProvider, lineAlternative, other];
      const before = JSON.stringify(ranked);
      const selected = SelectCompensatedLyrics(ranked, settings, pinned ? provider : undefined);
      const shouldYield = eligible(provider) && !pinned && (shape !== 'rich' || !passing || holdWordSync) && delta >= 0;
      if (shouldYield) assert.equal(selected, other);
      else assert.equal(selected.Source.Provider, provider);
      assert.equal(JSON.stringify(ranked), before, 'selection never reorders candidates or mutates raw data');
      const disabled = SelectCompensatedLyrics(ranked, { ...settings, holdSeconds: 0 }, pinned ? provider : undefined);
      assert.equal(disabled.Source.Provider, provider, 'resolution failure alone never yields');
    }
    const input = song(provider, 'rich');
    const first = rich(provider === 'Spicy' ? 'AMLL' : 'Spicy', 100, denseRows);
    const selected = SelectCompensatedLyrics([first, input], settings, provider);
    assert.equal(selected.Source.Provider, provider, 'manual selection also compensates a non-leading candidate without swapping it');
    assert.equal(selected.Source.RichSyncHoldSeconds, eligible(provider) ? 5 : undefined);
  });
}

for (const provider of providers) for (const pinned of [false, true]) {
  test(`${provider} ${pinned ? 'pinned' : 'Auto'}: toggle changes cached projections while preserving precision and timings`, () => {
    for (const shape of ['rich', 'failed rich', 'Line', 'wrapper', 'Static']) {
      const input = song(provider, shape === 'failed rich' ? 'rich' : shape, shape === 'failed rich' ? rows : denseRows);
      const before = JSON.stringify(input);
      const select = holdWordSync => SelectCompensatedLyrics([input], { ...defaults, holdWordSync }, pinned ? provider : undefined);
      for (let repeat = 0; repeat < 2; repeat++) {
        const off = select(false);
        const on = select(true);
        const heldWhenOff = eligible(provider) && ['failed rich', 'Line', 'wrapper'].includes(shape);
        const heldWhenOn = eligible(provider) && shape !== 'Static';
        assert.equal(off.Source.RichSyncHoldSeconds, heldWhenOff ? 5 : undefined);
        assert.equal(on.Source.RichSyncHoldSeconds, heldWhenOn ? 5 : undefined);
        assert.equal(on.Source.HasWordSync, off.Source.HasWordSync, 'toggle never changes precision');
        assert.equal(NormalizeLyrics(on).source.RichSyncHoldSeconds, heldWhenOn ? 5 : undefined);
        assert.equal(NormalizeLyrics(off).source.RichSyncHoldSeconds, heldWhenOff ? 5 : undefined);
        assert.equal(select(true), on, 'same effective projection is reused');
        assert.equal(select(false), off, 'toggle Off restores the original or unchanged line projection');
        if (!eligible(provider) || shape === 'Static') assert.equal(on, input);
      }
      assert.equal(JSON.stringify(input), before);
    }
  });
}

for (const provider of providers) for (const pinned of [false, true]) {
  test(`${provider} ${pinned ? 'pinned' : 'Auto'}: line-only mode follows setting changes without stale projections`, () => {
    for (const shape of ['Line', 'wrapper', 'rich']) {
      const input = song(provider, shape);
      const select = settings => SelectCompensatedLyrics([input], { ...settings, holdWordSync: false }, pinned ? provider : undefined);
      const original = JSON.stringify(input);
      const initial = select(defaults);
      const unchanged = select(defaults);
      assert.equal(initial, unchanged);
      for (let repeat = 0; repeat < 2; repeat++) {
        const noTest = select({ ...defaults, minimumSegmentsPerLine: 0 });
        assert.equal(noTest.Source.HasWordSync, input.Source.HasWordSync);
        assert.equal(noTest.Source.RichSyncHoldSeconds, eligible(provider) && shape !== 'rich' ? 5 : undefined);
        const noHold = select({ ...defaults, holdSeconds: 0 });
        assert.equal(noHold.Source.RichSyncHoldSeconds, undefined);
        assert.equal(noHold.Source.HasWordSync, eligible(provider) && shape === 'rich' ? false : input.Source.HasWordSync);
        const cutoff = select({ ...defaults, holdSeconds: 3 });
        assert.equal(cutoff.Source.RichSyncHoldSeconds, undefined);
        const changedHold = select({ ...defaults, holdSeconds: 4 });
        assert.equal(changedHold.Source.RichSyncHoldSeconds, eligible(provider) ? 4 : undefined);
        const passing = select({ ...defaults, minimumSegmentsPerLine: 1.25 });
        assert.equal(passing.Source.HasWordSync, input.Source.HasWordSync);
        assert.equal(passing.Source.RichSyncHoldSeconds, eligible(provider) && shape !== 'rich' ? 5 : undefined);
        assert.equal(select({ holdSeconds: 0, minimumSegmentsPerLine: 0 }), input);
        assert.equal(select(defaults).Source.RichSyncHoldSeconds, eligible(provider) ? 5 : undefined);
      }
      assert.equal(JSON.stringify(input), original);
    }
  });
}

test('candidate ranking keeps precision, timing counts, AMLL preference, provider order and track-ID ties', () => {
  const candidates = [];
  const expected = [];
  const append = (shape, count, order) => {
    for (const provider of order) for (const trackId of ['a', 'b']) {
      const entry = { provider, trackId, timings: count, lyrics: song(provider, shape, denseRows) };
      candidates.unshift(entry);
      expected.push(entry);
    }
  };
  const wordOrder = ['AMLL', 'Musixmatch', 'Spicy', 'Spotify', 'LRCLIB'];
  const lineOrder = ['Musixmatch', 'Spicy', 'AMLL', 'Spotify', 'LRCLIB'];
  append('rich', 10, wordOrder);
  append('rich', 4, wordOrder);
  append('Line', 100, lineOrder);
  append('Static', 200, lineOrder);
  assert.deepEqual([...candidates].sort(compareCandidates), expected);
  for (let i = 0; i < expected.length; i++) for (let j = 0; j < expected.length; j++) {
    assert.equal(Math.sign(compareCandidates(expected[i], expected[j])) || 0, Math.sign(i - j) || 0);
  }
  const wrapper = { ...expected[20], lyrics: song('Musixmatch', 'wrapper'), timings: 10000 };
  assert.equal(compareCandidates(wrapper, expected[20]), 0, 'wrappers retain line rank regardless of segment count');
  const ranked = expected.map(entry => entry.lyrics);
  const before = JSON.stringify(ranked);
  for (const settings of [defaults, { holdSeconds: 0, minimumSegmentsPerLine: 0 }, { holdSeconds: 10, minimumSegmentsPerLine: 20 }]) {
    SelectCompensatedLyrics(ranked, settings);
    assert.equal(JSON.stringify(ranked), before);
  }
});

// Execute the player's real selection/settings subscription, substituting only
// already-prepared choices and host signals. Any lookup on a settings edit fails.
const playerSource = readFileSync('Extension/Spices/Spicetify/Services/Player/mod.ts', 'utf8');
const selectionBlock = playerSource.slice(playerSource.indexOf('const GetSelectedLyrics ='), playerSource.indexOf('export let HaveSongLyricsLoaded'));
const selectionCode = transformSync(selectionBlock.replaceAll(/export /g, ''), { loader: 'ts' }).code;
const createSelection = new Function('deps', `
  const {SelectCompensatedLyrics,GetRichSyncSettings,OnRichSyncSettingsChanged,choices,cleanup,signal}=deps;
  const SongLyricChoices=choices, latestDetailsReady=undefined;
  let manualProvider,SongLyrics=SelectCompensatedLyrics(choices,GetRichSyncSettings()),SongLyricsError;
  const PlayerMaid={Give:dispose=>cleanup.push(dispose)},SongLyricsLoadedSignal={Fire:signal};
  const OnProviderSettingsChanged=()=>()=>{},LoadSongLyrics=()=>{throw Error('unexpected refetch')};
  ${selectionCode}
  return {SelectLyricsProvider,selected:()=>SongLyrics};`);
for (const provider of providers) for (const pinned of [false, true]) {
  test(`${provider} ${pinned ? 'pinned' : 'Auto'}: live setting edits reselect prepared lyrics without refetching`, () => {
    const previous = globalThis.localStorage;
    const storage = new Map([['BeautifulLyricsLocal/RichSyncCompensation', JSON.stringify({ ...defaults, holdWordSync: false })]]), cleanup = [];
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    let signals = 0;
    const input = song(provider, 'rich');
    const other = rich(provider === 'Musixmatch' ? 'Spicy' : 'Musixmatch', input.Source.UniqueTimings, denseRows);
    const choices = [input, other];
    const before = JSON.stringify(choices);
    try {
      const player = createSelection({ SelectCompensatedLyrics, GetRichSyncSettings, OnRichSyncSettingsChanged, choices, cleanup, signal: () => signals++ });
      if (pinned) player.SelectLyricsProvider(provider);
      const selected = player.selected();
      assert.equal(selected.Source.Provider, eligible(provider) && !pinned ? other.Source.Provider : provider);
      SaveRichSyncSetting('holdSeconds', 0);
      assert.equal(player.selected().Source.Provider, provider);
      assert.equal(player.selected().Source.HasWordSync, eligible(provider) ? false : true);
      assert.equal(player.selected().Source.RichSyncHoldSeconds, undefined);
      SaveRichSyncSetting('minimumSegmentsPerLine', 0);
      assert.equal(player.selected(), input);
      SaveRichSyncSetting('holdSeconds', 5);
      assert.equal(player.selected(), input, 'passing rich is not held with word hold Off');
      const unchangedSignals = signals;
      SaveRichSyncSetting('holdSeconds', 6);
      assert.equal(signals, unchangedSignals, 'unchanged effective selection does not remount');
      SaveRichSyncSetting('minimumSegmentsPerLine', 2);
      assert.equal(player.selected().Source.Provider, eligible(provider) && !pinned ? other.Source.Provider : provider);
      assert.equal(player.selected().Source.RichSyncHoldSeconds, eligible(provider) && pinned ? 6 : undefined);
      SaveRichSyncSetting('minimumSegmentsPerLine', 0);
      assert.equal(player.selected(), input);
      SaveRichSyncSetting('holdWordSync', true);
      assert.equal(player.selected().Source.Provider, eligible(provider) && !pinned ? other.Source.Provider : provider);
      assert.equal(player.selected().Source.HasWordSync, true, 'passing rich stays word precision when held');
      assert.equal(player.selected().Source.RichSyncHoldSeconds, eligible(provider) && pinned ? 6 : undefined);
      const toggleSignals = signals;
      SaveRichSyncSetting('holdWordSync', true);
      assert.equal(signals, toggleSignals, 'unchanged toggle does not remount');
      SaveRichSyncSetting('holdWordSync', false);
      assert.equal(player.selected(), input, 'live toggle Off restores unheld passing rich without refetching');
      assert.equal(JSON.stringify(choices), before);
      if (!eligible(provider)) assert.equal(player.selected(), input);
    } finally {
      cleanup.forEach(dispose => dispose());
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    }
  });
}

const chrome = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('real renderer holds a completed group in silence, preserves dots and uses the saved Line effects', { skip: !chrome }, async () => {
  const { code, css } = await buildVocalFixture(undefined, true, false, true, true);
  const projected = SelectCompensatedLyrics([rich('Musixmatch', 5, rows)], defaults);
  async function setup(song) {
    const { LyricsRenderer, PresentationSettings, ClassicRendering, ClassicLayout } = fixtureModule;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    PresentationSettings.saveRendering('NowPlaying', 'Line', { ...ClassicRendering, highlight: 'segment', scale: false, glow: false, blur: false });
    PresentationSettings.saveLayout('NowPlaying', { ...ClassicLayout, before: 0, after: 0, transition: 'instant' });
    PresentationSettings.saveCues('NowPlaying', { threshold: 1, motion: false });
    let time = 1;
    const consumers = new Set();
    const clock = { now: () => time, duration: () => 22, seek() {}, subscribe(fn) { consumers.add(fn); return () => consumers.delete(fn); } };
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new LyricsRenderer(host, song, false, 'NowPlaying', clock);
    try {
      const groups = [...host.querySelectorAll('.VocalsGroup')].filter(group => group.querySelector('.Vocals'));
      const first = groups[0].querySelector('.Vocals');
      const at = (value, seek) => { time = value; for (const fn of consumers) fn(.016, seek); };
      const held = () => host.querySelector('.RichSyncHold');
      at(1, true);
      check(!held() && host.querySelector('.Interlude.Active'), 'intro remains a cue');
      at(2.2);
      check(host.querySelector('.Lyrics').dataset.effectivePrecision === 'line' && first.querySelector('.Line'), 'fallback renders whole lines');
      check(first.dataset.jelHighlight === 'segment' && first.dataset.jelScale === 'off' && first.dataset.jelGlow === 'off', 'fallback uses the viewer Line settings exactly');
      // Establish the active paint before checking the transition into a hold.
      await new Promise(resolve => setTimeout(resolve, 300));
      check(getComputedStyle(first).opacity === '1', 'active text is fully lit before the hold');
      at(3);
      check(!held() && first.classList.contains('Active'), 'vocal end remains inclusive');
      at(3.01);
      check(held() === groups[0] && first.classList.contains('Sung') && !first.classList.contains('Active'), 'hold keeps a completed group without extending logical activity');
      check(getComputedStyle(first).opacity === '1', 'hold maintains full contrast');
      check(!host.querySelector('.Interlude.Active'), 'hold takes priority over dots');
      at(6);
      check(!held() && groups[1].querySelector('.Active'), 'hold ends at next vocal start');
      at(8, true);
      check(!held() && host.querySelector('.Interlude.Active'), 'exact five-second gap uses ordinary dots');
      at(4, true);
      check(held() === groups[0], 'backward seek reconstructs the hold');
      at(21, true);
      check(!held() && !host.querySelector('.Interlude.Active'), 'no hold after the last vocal');
    } finally { renderer.Destroy(); }
    jelTestComplete('RICH_SYNC_PASS');
  }
  const dir = path.resolve(await mkdtemp(path.join(tmpdir(), 'jel-rich-sync-')));
  try {
    const file = path.join(dir, 'fixture.html');
    const script = `${code};(${setup.toString()})(${JSON.stringify(projected)}).catch(error => jelTestComplete(error.stack));`;
    await writeFile(file, `<!doctype html><meta charset="utf-8"><style>${css}.LyricsScrollContainer{height:320px}.Lyrics{--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}</style><body><script>${script.replaceAll('</script', '<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome, file, path.join(dir, 'profile')), 'RICH_SYNC_PASS');
  } finally {
    assert.ok(dir.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith('jel-rich-sync-'));
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('real renderer matrix follows the word-hold toggle and retains cues for unheld gaps', { skip: !chrome }, async () => {
  const { code, css } = await buildVocalFixture(undefined, true, false, true, true);
  const cases = [];
  for (const provider of providers) for (const pinned of [false, true]) for (const holdWordSync of [false, true]) for (const scenario of scenarios) {
    const selected = SelectCompensatedLyrics([song(provider, scenario.shape, scenario.timing)], { ...(scenario.settings || defaults), holdWordSync }, pinned ? provider : undefined);
    const document = NormalizeLyrics(selected);
    const gap = DeriveCueCandidates(document).find(cue => cue.internal);
    cases.push({ name: `${provider} ${pinned ? 'pinned' : 'Auto'} word hold ${holdWordSync} ${scenario.name}`, song: selected,
      precision: document.precision, time: gap ? gap.start + .5 : document.end + .5,
      held: !!selected.Source.RichSyncHoldSeconds, cue: !!gap && !selected.Source.RichSyncHoldSeconds,
      nextStart: gap?.nextVocalStart });
  }
  async function setup(cases) {
    const { LyricsRenderer, PresentationSettings, ClassicRendering, ClassicLayout } = fixtureModule;
    PresentationSettings.saveRendering('NowPlaying', 'Line', { ...ClassicRendering, scale: false, glow: false, blur: false });
    PresentationSettings.saveRendering('NowPlaying', 'Word', { ...ClassicRendering, scale: false, glow: false, blur: false });
    PresentationSettings.saveLayout('NowPlaying', { ...ClassicLayout, before: null, after: null, transition: 'instant' });
    PresentationSettings.saveCues('NowPlaying', { threshold: 1, motion: false });
    for (const entry of cases) {
      const check = (ok, message) => { if (!ok) throw Error(entry.name + ': ' + message); };
      let time = 1;
      const consumers = new Set();
      const clock = { now: () => time, duration: () => 30, seek() {}, subscribe(fn) { consumers.add(fn); return () => consumers.delete(fn); } };
      const host = document.createElement('div');
      document.body.append(host);
      const renderer = new LyricsRenderer(host, entry.song, false, 'NowPlaying', clock);
      try {
        const at = value => { time = value; for (const fn of consumers) fn(.016, true); };
        at(entry.time);
        check(host.querySelector('.Lyrics').dataset.effectivePrecision === entry.precision, 'effective precision');
        check(!!host.querySelector('.RichSyncHold') === entry.held, 'hold class matches compensation');
        check(!!host.querySelector('.Interlude.Active') === entry.cue, 'unheld internal gaps retain active dots');
        if (entry.nextStart !== undefined) {
          at(entry.nextStart);
          check(!host.querySelector('.RichSyncHold'), 'next vocal releases hold');
          at(entry.time);
          check(!!host.querySelector('.RichSyncHold') === entry.held, 'backward seek reconstructs hold state');
        }
        at(1);
        check(!host.querySelector('.RichSyncHold'), 'intro never held');
      } finally { renderer.Destroy(); host.remove(); }
      check(consumers.size === 0, 'clock subscription cleaned up');
    }
    jelTestComplete('RICH_SYNC_MATRIX_PASS');
  }
  const dir = path.resolve(await mkdtemp(path.join(tmpdir(), 'jel-rich-sync-')));
  try {
    const file = path.join(dir, 'fixture.html');
    const script = `${code};(${setup.toString()})(${JSON.stringify(cases)}).catch(error => jelTestComplete(error.stack));`;
    await writeFile(file, `<!doctype html><meta charset="utf-8"><style>${css}.LyricsScrollContainer{height:320px}.Lyrics{--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}</style><body><script>${script.replaceAll('</script', '<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome, file, path.join(dir, 'profile')), 'RICH_SYNC_MATRIX_PASS');
  } finally {
    assert.ok(dir.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith('jel-rich-sync-'));
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
