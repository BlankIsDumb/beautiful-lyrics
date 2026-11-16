import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { settle } from './cache-fixture.mjs';

const source=readFileSync('Extension/Source/LyricViews/Page/Shared.ts','utf8');
const {code}=transformSync(source.slice(source.indexOf('export const CreateLyricsRenderer'),source.indexOf('// Handle Romanization Toggling')).replace('export ',''),{loader:'ts'});
const render=new Function('state','document','container','maid','fullscreen',`
 const {SongLyrics,SongLyricsError,SongLyricsOutcomes,HaveSongLyricsLoaded}=state;
 const SongChanged={Connect(){}},SongLyricsLoaded={Connect(){}},Icons={LoadingLyrics:'loading'},LyricsRenderer=class{constructor(){throw Error('unexpected renderer')}};
 const CreateElement=()=>document.createElement('span');
 ${code}; CreateLyricsRenderer(container,maid,fullscreen?undefined:'no lyrics');`);
function element(){return {children:[],className:'',textContent:'',append(...nodes){this.children.push(...nodes)},appendChild(node){this.children.push(node)},classList:{add(){},remove(){}},set innerHTML(value){throw Error('HTML is forbidden')}};}

test('Full Lyrics keeps no-lyrics and appends a text-only failed-provider note; all-failed uses error text',()=>{
 for(const error of [undefined,'All providers failed']) {
  const container=element(),document={createElement:element};const reason='<img src=x onerror=steal()>',maid={Clean(){},Give:item=>item};
  render({SongLyrics:undefined,HaveSongLyricsLoaded:true,SongLyricsError:error,SongLyricsOutcomes:[{Provider:'Spicy',State:'failed',Reason:reason},{Provider:'Spotify',State:'none'}]},document,container,maid);
  assert.equal(container.children.length,1);const message=container.children[0];
  if(error){assert.equal(message.textContent,error);assert.equal(message.children.length,0);}
  else {assert.equal(message.children[0].className,'ProviderFailures');assert.equal(message.children[0].textContent,"Couldn't check: Spicy ("+reason+')');}
 }
});

test('all-none page has no failure note',()=>{
 const container=element();render({SongLyrics:undefined,HaveSongLyricsLoaded:true,SongLyricsOutcomes:[{Provider:'Spotify',State:'none'}]},{createElement:element},container,{Clean(){},Give:item=>item});assert.equal(container.children[0].children.length,0);
});

const controls=readFileSync('Extension/Source/ProviderControls.ts','utf8');
const probe=new Function('GetSpicyToken','IsProviderEnabled','GlobalMaid','ShowNotification','fetch',controls.slice(controls.indexOf('// One bounded local probe'),controls.indexOf('// Use Spicetify')));
test('Spicy startup probe/toast requires both enabled and token, including at delayed failure',async()=>{
 for(const enabled of [true,false])for(const token of ['','fixture']) {
  let requests=0,toasts=0;const cleanup=[];
  probe(()=>token,()=>enabled,{Give:fn=>cleanup.push(fn),IsDestroyed:()=>false},()=>toasts++,async()=>{requests++;throw Error('offline')});await settle();
  assert.equal(requests,enabled&&token?1:0);assert.equal(toasts,enabled&&token?1:0);for(const fn of cleanup)fn();
 }
 let enabled=true,reject,toasts=0;const cleanup=[];
 probe(()=>'fixture',()=>enabled,{Give:fn=>cleanup.push(fn),IsDestroyed:()=>false},()=>toasts++,()=>new Promise((_,fail)=>{reject=fail}));enabled=false;reject(Error('offline'));await settle();assert.equal(toasts,0);for(const fn of cleanup)fn();
});

test('Fullscreen creates a partial-failure message only when needed and leaves the error placement class intact',()=>{
 const css=readFileSync('Extension/Source/LyricViews/Page/style.scss','utf8');
 for(const outcome of ['none','partial','error']) {
  const container=element(),state={SongLyrics:undefined,HaveSongLyricsLoaded:true,SongLyricsError:outcome==='error'?'All providers failed':undefined,SongLyricsOutcomes:[{Provider:'Spicy',State:outcome==='none'?'none':'failed',Reason:'relay unavailable'}]};
  render(state,{createElement:element},container,{Clean(){},Give:item=>item},true);
  if(outcome==='none')assert.equal(container.children.length,0);
  else {
   assert.equal(container.children.length,1);const message=container.children[0];
   if(outcome==='partial') {assert.equal(message.className,'NoLyrics PartialProviderFailure');assert.match(message.textContent,/doesn't have any Lyrics/);assert.equal(message.children[0].textContent,"Couldn't check: Spicy (relay unavailable)");}
   else {assert.equal(message.className,'NoLyrics');assert.equal(message.textContent,'All providers failed');assert.equal(message.children.length,0);}
  }
 }
 // Tie the class assertion to the positioning rule: the error's unchanged
 // NoLyrics class must not inherit the partial-message placement again.
 assert.match(css,/\.Fullscreen \.Content > \.PartialProviderFailure\s*\{/);
 assert.doesNotMatch(css,/\.Fullscreen \.Content > \.NoLyrics\s*\{/);
});
