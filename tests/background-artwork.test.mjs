import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';

const built=await build({stdin:{contents:`export * from './Extension/Source/Modules/Background/BackgroundArtwork.ts';export * from '@Spices/Spicetify/Services/Player/mod.ts';export * from './Extension/Source/LyricViews/Shared.ts';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',plugins:[{name:'artwork-host',setup(b){
  b.onResolve({filter:/^@Universal\//},a=>({path:path.resolve('Universal',a.path.slice('@Universal/'.length))}));
  b.onResolve({filter:/Player\/mod\.ts$/},()=>({path:'player',namespace:'fixture'}));
  b.onResolve({filter:/LyricViews\/Shared\.ts$/},()=>({path:'shared',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='shared'?`export let cover=['one',undefined];export const setCover=value=>{cover=value};export const GetCoverArtForSong=()=>cover;`:`
    export const subscriptions={song:new Set(),context:new Set()};
    const event=list=>({Connect(fn){list.add(fn);return {Disconnect(){list.delete(fn)}}}});
    export const SongChanged=event(subscriptions.song),SongContextChanged=event(subscriptions.context);
    export const fire=()=>{for(const f of subscriptions.song)f();for(const f of subscriptions.context)f()};
  `}));
}}]});
let serial=0;
async function setup(run){
  const old={Image:globalThis.Image,OffscreenCanvas:globalThis.OffscreenCanvas};
  const pending=[],canvases=[];
  globalThis.Image=class{width=640;height=640;decode(){return new Promise((resolve,reject)=>pending.push({resolve,reject,src:this.src}))}};
  globalThis.OffscreenCanvas=class{constructor(){canvases.push(this)}getContext(){return {beginPath(){},arc(){},closePath(){},clip(){},drawImage(){}}}};
  try{const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+`\n//${serial++}`).toString('base64'));await run(m,pending,canvases)}finally{Object.assign(globalThis,old)}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('zero consumers do no work; refcount dedupes artwork and disconnects last release',()=>setup(async(m,pending,canvases)=>{
  assert.equal(pending.length,0);assert.equal(m.subscriptions.song.size,0);m.fire();assert.equal(pending.length,0);
  const a=m.Acquire(),b=m.Acquire();assert.equal(pending.length,1);assert.equal(m.subscriptions.song.size,1);assert.equal(m.subscriptions.context.size,1);
  m.fire();assert.equal(pending.length,1);pending[0].resolve();await settle();
  const canvas=a.Current();assert.ok(canvas);assert.equal(b.Current(),canvas);assert.equal(canvases.length,2);
  a.Release();a.Release();assert.equal(m.subscriptions.song.size,1);assert.equal(a.Current(),undefined);
  b.Release();assert.equal(m.subscriptions.song.size,0);assert.equal(m.subscriptions.context.size,0);assert.equal(b.Current(),undefined);
  const c=m.Acquire();assert.equal(c.Current(),canvas);assert.equal(pending.length,1);c.Release();
  m.fire();assert.equal(pending.length,1);
}));

test('stale URL/hue results and release during decode cannot publish or blur',()=>setup(async(m,pending,canvases)=>{
  const a=m.Acquire();let events=0;const connection=a.Changed.Connect(()=>events++);
  m.setCover(['two',30]);m.fire();pending[0].resolve();await settle();assert.equal(canvases.length,0);assert.equal(events,0);
  m.setCover(['two',45]);m.fire();pending[1].resolve();await settle();assert.equal(canvases.length,0);
  pending[2].resolve();await settle();assert.equal(events,1);assert.ok(a.Current());
  m.setCover(['three',undefined]);m.fire();a.Release();pending[3].resolve();await settle();assert.equal(canvases.length,2);assert.equal(events,1);
  connection.Disconnect();
}));

test('decode failure is nonfatal and a subsequent artwork event can retry',()=>setup(async(m,pending)=>{
  const a=m.Acquire();pending[0].reject(Error('unavailable'));await settle();assert.equal(a.Current(),undefined);
  m.fire();assert.equal(pending.length,2);pending[1].resolve();await settle();assert.ok(a.Current());a.Release();
}));
