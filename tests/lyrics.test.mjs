import test from 'node:test';
import assert from 'node:assert/strict';
import { convertRichsync, convertSubtitles } from '../Extension/Spices/Spicetify/Services/Player/MusixmatchLyrics.mjs';

test('preserves actual offsets and separates whitespace without inventing timing', () => {
  const lyrics = convertRichsync([{ ts: 2, te: 5, l: [{c:'Hello',o:0},{c:' ',o:1},{c:'world',o:1.2}] }]);
  assert.equal(lyrics.Type, 'Syllable');
  assert.deepEqual(lyrics.Content[0].Lead.Syllables, [
    {Text:'Hello',StartTime:2,EndTime:3,IsPartOfWord:false},
    {Text:'world',StartTime:3.2,EndTime:5,IsPartOfWord:false},
  ]);
});
test('keeps adjacent syllables joined, and preserves Japanese phrase granularity', () => {
  const lyrics = convertRichsync([{ ts:0,te:3,l:[{c:'花',o:0},{c:'びら',o:1},{c:' ',o:2},{c:'空の色',o:2.1}] }]);
  assert.deepEqual(lyrics.Content[0].Lead.Syllables.map(s=>s.IsPartOfWord), [true,false,false]);
  assert.equal(lyrics.Content[0].Lead.Syllables[2].Text,'空の色');
});
test('rejects malformed or backwards timing', () => {
  assert.throws(()=>convertRichsync([{ts:2,te:4,l:[{c:'a',o:2},{c:'b',o:1}]}]));
  assert.throws(()=>convertRichsync([{ts:0,te:1,l:[{c:'a',o:NaN}]}]));
});
test('empty or whitespace-only lyrics are absent, not a crashing renderer input', () => {
  assert.equal(convertRichsync([]),undefined);
  assert.equal(convertRichsync([{ts:0,te:1,l:[{c:' ',o:0}]}]),undefined);
});
test('line fallback uses next timestamp and duration, keeping instrumental gaps', () => {
  const lyrics=convertSubtitles([{text:'a',time:{total:1}},{text:'',time:{total:3}},{text:'b',time:{total:5}}],8);
  assert.equal(lyrics.Type,'Line');
  assert.deepEqual(lyrics.Content.map(l=>[l.StartTime,l.EndTime]),[[1,3],[5,8]]);
});

test('BMTH separator inversion and simultaneous words survive without manufactured timing',()=>{
  const lyrics=convertRichsync([{ts:21.48,te:22.456,l:[{c:'word',o:0},{c:' ',o:.976},{c:'last',o:.975},{c:'echo',o:.976}]}]);
  assert.deepEqual(lyrics.Content[0].Lead.Syllables.map(s=>[s.Text,s.StartTime,s.EndTime]),[
    ['word',21.48,22.456],['last',22.455000000000002,22.456],['echo',22.456,22.456]
  ]);
});
test('overlapping vocal lines retain their independent intervals',()=>{
  const lyrics=convertRichsync([{ts:0,te:10,l:[{c:'lead',o:0}]},{ts:2,te:4,l:[{c:'backing',o:0}]}]);
  assert.equal(lyrics.Content[0].Lead.EndTime,10);
  assert.equal(lyrics.Content[1].Lead.StartTime,2);
});


test('instantaneous whole lines survive, but backwards lines remain invalid', () => {
  for (const time of [25.154, 88.313, 141.05]) {
    const lyrics = convertRichsync([{ts:time,te:time,l:[{c:'instant',o:0}]}]);
    assert.equal(lyrics.Content[0].Lead.Syllables[0].StartTime,time);
    assert.equal(lyrics.Content[0].Lead.Syllables[0].EndTime,time);
  }
  assert.throws(() => convertRichsync([{ts:2,te:1,l:[{c:'backwards',o:0}]}]));
});
