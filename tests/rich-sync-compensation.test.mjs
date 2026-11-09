import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { runFocusedFixture } from './chromium-focus-harness.mjs';
import { buildVocalFixture } from './renderer-fixture.mjs';

const module = await build({ stdin: { contents: `
  export * from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts';
  export * from './Extension/Source/Modules/RichSyncCompensation.ts';
  export {NormalizeLyrics} from './Extension/Source/Modules/LyricDocument.ts';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm' });
const { GetRichSyncSettings, SaveRichSyncSetting, OnRichSyncSettingsChanged, OnProviderSettingsChanged,
  OnBehaviorSettingsChanged, SelectCompensatedLyrics, NormalizeLyrics } = await import(
  'data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].text).toString('base64'));

const defaults = { holdSeconds: 5, minimumSegmentsPerLine: 2 };
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
    assert.deepEqual(GetRichSyncSettings(), { holdSeconds: 0, minimumSegmentsPerLine: 0 });
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
  const settings = { holdSeconds: 5, minimumSegmentsPerLine: 0 };
  assert.equal(SelectCompensatedLyrics([mm, other], settings), mm, 'intro and exact five-second gaps stay on ordinary cue rules');
  assert.equal(SelectCompensatedLyrics([mm, other], { ...settings, holdSeconds: 5.001 }), other);
  mm.Content[0].Background = [{ StartTime: 3.2, EndTime: 9, Syllables: [{ Text: 'backing', StartTime: 3.2, EndTime: 9 }] }];
  const withBacking = structuredClone(mm); // a fresh provider result
  assert.equal(SelectCompensatedLyrics([withBacking, other], { ...settings, holdSeconds: 10 }), withBacking);
});

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
