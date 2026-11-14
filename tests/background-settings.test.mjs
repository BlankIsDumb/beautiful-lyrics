import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built = await build({entryPoints:['Extension/Source/BackgroundSettings.ts'],bundle:true,write:false,format:'esm'});
const {NormalizeBackground, DefaultBackgrounds, ClassicBackground} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('efficient defaults are per-view, normalized by field and copied', () => {
  assert.deepEqual(DefaultBackgrounds.FullLyrics,{mode:'animated',motion:'classic',brightness:100,paused:'freeze',fps:'30',resolution:'half'});
  assert.equal(DefaultBackgrounds.NowPlaying.mode,'off');
  for (const view of ['FullLyrics','NowPlaying']) {
    const defaults = DefaultBackgrounds[view];
    const profile = NormalizeBackground({mode:'broken',motion:2,brightness:NaN,paused:null,fps:30,resolution:'auto'},defaults);
    assert.deepEqual(profile,defaults); assert.notEqual(profile,defaults);
    assert.deepEqual(NormalizeBackground(null,defaults),defaults);
    for (const brightness of [49,151,102,100.5,Infinity,'100']) assert.equal(NormalizeBackground({brightness},defaults).brightness,100);
    assert.deepEqual(NormalizeBackground({mode:'static',motion:'fast',brightness:150,paused:'animate',fps:'15',resolution:'quarter'},defaults),
      {mode:'static',motion:'fast',brightness:150,paused:'animate',fps:'15',resolution:'quarter'});
  }
});

test('Classic restores look while preserving quality; reset uses viewer defaults', () => {
  const value = NormalizeBackground({mode:'off',motion:'slow',brightness:50,fps:'60',resolution:'full'});
  assert.deepEqual(ClassicBackground(value),{mode:'animated',motion:'classic',brightness:100,paused:'animate',fps:'60',resolution:'full'});
  assert.equal(value.mode,'off');
  assert.deepEqual(NormalizeBackground(undefined,DefaultBackgrounds.NowPlaying),DefaultBackgrounds.NowPlaying);
  assert.deepEqual(NormalizeBackground(undefined,DefaultBackgrounds.FullLyrics),DefaultBackgrounds.FullLyrics);
});
