import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:"export * from './Extension/Source/ContextAppearance.ts';export * from './Extension/Source/PresentationSettings.ts';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const {CreatePresentationSettings,NormalizeContextAppearance,ClassicContextAppearance,ContextOpacity}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const key='JustEnoughLyrics/Presentation';
test('appearance normalizes finite independent controls without shared defaults',()=>{
 assert.deepEqual(NormalizeContextAppearance({mode:'other',blur:NaN,darkening:101,opacity:-1}),ClassicContextAppearance);
 const p=NormalizeContextAppearance({mode:'muted',blurEnabled:false,blur:0,darkeningEnabled:false,darkening:100,opacity:0});
 assert.equal(p.blur,0);assert.equal(p.darkening,100);assert.equal(p.opacity,0);p.blur=12;assert.equal(NormalizeContextAppearance().blur,2);
 assert.equal(Object.keys(p).some(k=>/gradient|mask/i.test(k)),false);
});
test('schemas1–10 lazily preserve exact raw, collision backups, failed writes and view isolation',()=>{
 for(let version=1;version<=10;version++){
  const raw=JSON.stringify({version,fontFamily:'serif',horizontalSpacing:{Card:-50,Contained:20,Fullscreen:40},profiles:{NowPlaying:{layout:{before:1,after:2,anchor:62.5}},FullLyrics:{layout:{before:0}}}},null,3);
  const data=new Map([[key,raw],[key+'/Migration/schema'+version,'OLDER']]),writes=[],events=[];let failure='';
  const s=CreatePresentationSettings({getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes.push(k);if(failure==='backup'&&k!==key||failure==='main'&&k===key)throw Error('quota');data.set(k,v)}});
  s.subscribeContextAppearance(v=>events.push(v));s.subscribe(()=>assert.fail('appearance changed conversion'));
  assert.deepEqual(s.getContextAppearance('NowPlaying'),ClassicContextAppearance);s.saveContextAppearance('NowPlaying',s.getContextAppearance('NowPlaying'));assert.equal(writes.length,0);assert.equal(data.get(key),raw);
  const stale=s.getProfile('NowPlaying'),next={...s.getContextAppearance('NowPlaying'),mode:'muted',blurEnabled:false,opacity:0};
  for(const type of ['backup','main']){failure=type;assert.throws(()=>s.saveContextAppearance('NowPlaying',next));assert.deepEqual(s.getContextAppearance('NowPlaying'),ClassicContextAppearance);assert.equal(events.length,0);assert.equal(data.get(key),raw);}
  failure='';s.saveContextAppearance('NowPlaying',next);assert.equal(events.length,1);assert.equal(JSON.parse(data.get(key)).version,12);assert.equal(data.get(key+'/Migration/schema'+version),'OLDER');assert.ok([...data].some(([k,v])=>k.startsWith(key+'/Migration/schema'+version+'/')&&v===raw));
  assert.deepEqual(s.getContextAppearance('FullLyrics'),ClassicContextAppearance);s.saveProfile('NowPlaying',stale);assert.deepEqual(s.getContextAppearance('NowPlaying'),next);
  if(version===9)assert.equal(s.getHorizontalSpacing('Card'),-50);
  const before=writes.length;s.resetLayout('NowPlaying','context');assert.equal(writes.length,before+1);assert.deepEqual(s.getContextAppearance('NowPlaying'),ClassicContextAppearance);assert.equal(s.getLayout('NowPlaying').before,0);if(version>=8)assert.equal(s.getLayout('NowPlaying').anchor,62.5);
 }
});
test('schema11 reopening, narrow subscriptions, no-op/reset failure and future read-only',()=>{
 const data=new Map(),events=[];let fail=false;const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('quota');data.set(k,v)}};
 const s=CreatePresentationSettings(storage),stop=s.subscribeContextAppearance(v=>events.push(v));const value={...s.getContextAppearance('FullLyrics'),mode:'muted',opacity:80};s.saveContextAppearance('FullLyrics',value);s.saveContextAppearance('FullLyrics',value);assert.deepEqual(events,['FullLyrics']);
 const reopened=CreatePresentationSettings(storage);assert.deepEqual(reopened.getContextAppearance('FullLyrics'),value);fail=true;assert.throws(()=>s.resetLayout('FullLyrics','context'));assert.deepEqual(s.getContextAppearance('FullLyrics'),value);assert.equal(events.length,1);fail=false;stop();s.resetLayout('FullLyrics','context');assert.equal(events.length,1);
 data.set(key,JSON.stringify({version:13}));const future=CreatePresentationSettings(storage);assert.equal(future.isReadOnly(),true);assert.throws(()=>future.saveContextAppearance('NowPlaying',value));assert.equal(JSON.parse(data.get(key)).version,13);
});
test('fade fields normalize to Classic Off, 4, 0 unless valid',()=>{
 const classic={fade:false,fadeLength:4,fadeEnd:0},pick=v=>({fade:v.fade,fadeLength:v.fadeLength,fadeEnd:v.fadeEnd});
 assert.deepEqual(pick(ClassicContextAppearance),classic);assert.deepEqual(pick(NormalizeContextAppearance({mode:'muted',opacity:50})),classic);
 assert.deepEqual(pick(NormalizeContextAppearance({fade:true,fadeLength:1,fadeEnd:100})),{fade:true,fadeLength:1,fadeEnd:100});
 assert.deepEqual(pick(NormalizeContextAppearance({fade:true,fadeLength:20,fadeEnd:12.5})),{fade:true,fadeLength:20,fadeEnd:12.5});
 for(const fadeLength of [0,21,2.5,NaN,Infinity,'4',null,2**53])assert.equal(NormalizeContextAppearance({fadeLength}).fadeLength,4,String(fadeLength));
 for(const fadeEnd of [-1,100.5,NaN,Infinity,'5',null])assert.equal(NormalizeContextAppearance({fadeEnd}).fadeEnd,0,String(fadeEnd));
 for(const fade of ['true',1,null])assert.equal(NormalizeContextAppearance({fade}).fade,false,String(fade));
});
test('ContextOpacity is flat per line and linear over the fade length',()=>{
 const a={...ClassicContextAppearance,mode:'muted',opacity:35,fadeLength:4,fadeEnd:0};
 for(const d of [1,2,5,9])assert.equal(ContextOpacity(a,false,d),35);
 assert.deepEqual([1,2,3,4,5,6].map(d=>ContextOpacity(a,true,d)),[35,26.25,17.5,8.75,0,0]);
 for(const d of [1,2,5,30])assert.equal(ContextOpacity({...a,fadeEnd:80},true,d),35);
 const one={...a,fadeLength:1,fadeEnd:10};assert.equal(ContextOpacity(one,true,1),35);assert.equal(ContextOpacity(one,true,2),10);assert.equal(ContextOpacity(one,true,7),10);
});
