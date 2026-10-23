import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { convertAmll, ttmlTime } from '../Extension/Spices/Spicetify/Services/Player/AmllLyrics.mjs';
import { timingProgress, uniqueTimingCount } from '../Extension/Spices/Spicetify/Services/Player/LyricTiming.mjs';
import { overlapScrollTarget } from '../Extension/Source/Modules/LyricsRenderer/OverlapScroll.mjs';
const wrap = body => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>${body}</div></body></tt>`;
const parse = xml => convertAmll(xml, 60, DOMParser);

test('AMLL preserves internal pauses, whitespace, overlapping lead/background and singer alignment', () => {
  const result = parse(wrap(`<p begin="1s" end="8s" ttm:agent="a"><span begin="1s" end="2s">First </span><span begin="4s" end="6s">phrase</span><span ttm:role="x-bg"><span begin="3s" end="8s">echo</span></span><span ttm:role="x-translation">translation excluded</span></p><p begin="5s" end="9s" ttm:agent="b"><span begin="5s" end="9s">Other</span></p>`));
  assert.deepEqual(result.Content[0].Lead.Syllables.map(s=>[s.Text,s.StartTime,s.EndTime,s.IsPartOfWord]), [['First',1,2,false],['phrase',4,6,false]]);
  assert.equal(result.Content[0].Background[0].EndTime,8);
  assert.equal(result.Content[1].OppositeAligned,true);
  assert.equal(uniqueTimingCount(result),4);
});
test('TTML supports line timing, entities, adjacent syllables and clock units',()=>{
  assert.equal(ttmlTime('01:02.500'),62.5);
  assert.equal(ttmlTime('1500ms'),1.5);
  const result=parse(wrap('<p begin="1s" dur="2s">A &amp; B</p><p begin="4s" end="6s"><span begin="4s" end="5s">a</span><span begin="5s" end="6s">b</span></p>'));
  assert.equal(result.Content[0].Lead.Syllables[0].Text,'A & B');
  assert.equal(result.Content[1].Lead.Syllables[0].IsPartOfWord,true);
});
test('rejects XML declarations with entities and invalid or wrong-duration timings',()=>{
  assert.throws(()=>parse('<!DOCTYPE tt><tt/>'));
  assert.throws(()=>parse(wrap('<p begin="4s" end="2s">bad</p>')));
  assert.throws(()=>parse(wrap('<p begin="1s" end="200s">wrong version</p>')));
});
test('instantaneous vocals do not create NaN and duplicate starts do not inflate ranking',()=>{
  assert.equal(timingProgress(2,2,0),1);
  assert.equal(timingProgress(1,2,0),0);
  const result=parse(wrap('<p begin="1s" end="2s"><span begin="1s" end="1s">a</span><span begin="1s" end="2s">b</span></p>'));
  assert.equal(uniqueTimingCount(result),1);
});
test('overlap scrolling defers when all fit, reveals clipped lines, and prioritizes newest when too tall',()=>{
  const rows=[{top:100,bottom:180,start:1},{top:200,bottom:280,start:2}];
  assert.equal(overlapScrollTarget(rows,300,0,1000),0);
  assert.equal(overlapScrollTarget(rows,200,0,1000),80);
  assert.equal(overlapScrollTarget(rows,100,0,1000),180);
  // Font growth changes measured bounds; no fixed number of lines is assumed.
  assert.equal(overlapScrollTarget([{top:100,bottom:300,start:1},{top:330,bottom:530,start:2}],300,0,1000),230);
  assert.equal(overlapScrollTarget(rows,300,400,1000),100);
});
