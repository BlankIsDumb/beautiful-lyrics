import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricsRequired } from '../Extension/Spices/Spicetify/Services/Player/LyricDemand.mjs';

test('on-demand fetching is limited to our consumers; sidebar opt-in overrides the page gate',()=>{
  const settings={fetchMode:'required',sidebarEnabled:false};
  for(const path of ['/playlist/abc','/lyrics-plus','/BeautifulLyricsUnknown','/'])assert.equal(lyricsRequired(settings,path),false);
  for(const path of ['/BeautifulLyrics/Page','/BeautifulLyrics/Fullscreen'])assert.equal(lyricsRequired(settings,path),true);
  assert.equal(lyricsRequired({...settings,sidebarEnabled:true},'/playlist/abc'),true);
  assert.equal(lyricsRequired({...settings,fetchMode:'change'},'/playlist/abc'),true);
});
