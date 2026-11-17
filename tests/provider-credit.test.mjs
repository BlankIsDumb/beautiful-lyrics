import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

const {code}=await transform(readFileSync('Extension/Source/ProviderCredit.ts','utf8'),{loader:'ts',format:'esm'});
const {BuildProviderCredit:credit}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const spicy=(Source,People=[])=>({Source:{Provider:'Spicy'},Attribution:{Source,People}});
const uploader={Name:'Sppq',URL:'https://spicylyrics.org/user/sppq',Role:'Uploader'};
const maker={Name:'ShoQB',Role:'Maker'};

test('all providers have a credit; only Spicy reads Attribution',()=>{
  for(const lyrics of [undefined,{}, {Source:{}}, {Source:{Provider:''}}])assert.equal(credit(lyrics),undefined);
  for(const provider of ['Musixmatch','AMLL','LRCLIB','Spotify','Other Provider']) {
    assert.deepEqual(credit({Source:{Provider:provider},Attribution:spicy('spicy_lyrics',[uploader]).Attribution}),{provider,people:[]});
  }
});

test('Spicy sources use exact display names and suppress unrelated people',()=>{
  for(const [source,display] of [['apple_music','Apple Music'],['spotify','Spotify'],['','Unknown source'],['unknown','Unknown source'],['other_music_source','Other Music Source']]) {
    assert.deepEqual(credit(spicy(source,[uploader])),{provider:'Spicy Lyrics',source:display,people:[]});
  }
  assert.deepEqual(credit({Source:{Provider:'Spicy'}}),{provider:'Spicy Lyrics',source:'Unknown source',people:[]});
  assert.deepEqual(credit(spicy('spicy_lyrics')),{provider:'Spicy Lyrics',people:[]});
});

test('Spicy people preserve order, roles, legacy names, links and exact duplicate identity',()=>{
  const first={name:'Sppq',url:uploader.URL,title:'Uploader: Sppq'},second={name:'ShoQB',url:undefined,title:'Maker: ShoQB'};
  assert.deepEqual(credit(spicy('spicy_lyrics',[uploader])).people,[first]);
  assert.deepEqual(credit(spicy('spicy_lyrics',[maker])).people,[second]);
  assert.deepEqual(credit(spicy('spicy_lyrics',[uploader,maker])).people,[first,second]);
  assert.deepEqual(credit(spicy('spicy_lyrics',[uploader,{...uploader,Role:'Maker'}])).people,[{...first,title:'Uploader and maker: Sppq'}]);
  assert.equal(credit(spicy('spicy_lyrics',[uploader,{...uploader,URL:undefined}])).people.length,2);
  assert.deepEqual(credit(spicy('spicy_lyrics',[{Name:'Legacy'},{Name:'',Role:'Maker'},{Name:'  '}])).people,[{name:'Legacy',url:undefined,title:'Legacy'}]);
});

test('renderer no longer creates attribution in any surface and card preserves the legacy stored key',()=>{
  const renderer=readFileSync('Extension/Source/Modules/LyricsRenderer.ts','utf8'),card=readFileSync('Extension/Source/LyricViews/Card/mod.ts','utf8');
  assert.doesNotMatch(renderer,/BL-Attribution|createElement\(['"]a['"]\)/);
  assert.doesNotMatch(card,/CardLyricsVisible|ExpandedControls|RomanizationIcons|RomanizeTooltip|ShowLyrics|SetLyricsVisibility|ReactToLyricsVisibility|#Romanize|#Page|#Close/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/Card/style.scss','utf8'),/\.Controls|\.ViewControl|\.ShowLyrics/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/style.scss','utf8'),/#BeautifulLyrics-CardView[^\n]*\.ViewControl/);
  assert.match(renderer,/PresentationSettings\.subscribe\(\(changedView, languages\)/);
  assert.match(readFileSync('Extension/Source/LyricViews/Shared.ts','utf8'),/CardLyricsVisible: false/);
});
