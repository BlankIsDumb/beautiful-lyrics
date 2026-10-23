import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DOMParser } from '@xmldom/xmldom';
const code=await build({entryPoints:['Extension/Spices/Spicetify/Services/Player/LyricsProviders.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'mock-providers',setup(b){
  b.onResolve({filter:/Cache\.ts$/},()=>({path:'cache',namespace:'fake'}));
  b.onResolve({filter:/Musixmatch\.ts$/},()=>({path:'mxm',namespace:'fake'}));
  b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path==='cache'?'export const GetExpireStore=(name)=>({GetItem:async key=>globalThis.stores.get(name+key),SetItem:async(key,value)=>globalThis.stores.set(name+key,value)});':'export const FetchMusixmatchLyrics=(...args)=>globalThis.mxm(...args);'}));
}}]});
let serial=0;
const id='0123456789012345678901',alias='1123456789012345678901';
const track={uri:'spotify:track:'+id};
const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="2s"><span begin="0s" end="1s">one </span><span begin="1s" end="2s">two</span></p></div></body></tt>';
async function setup(){globalThis.stores=new Map();globalThis.DOMParser=DOMParser;return import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text+`\n//${serial++}`).toString('base64'));}
test('canonical mapping is deduplicated and finer AMLL wins; cached providers avoid repeat requests',async()=>{
  const p=await setup();let requests=0,mxmRequests=0;
  globalThis.fetch=async url=>{requests++;return url.includes(alias)?new Response(xml):new Response('',{status:404});};
  globalThis.mxm=async()=>{mxmRequests++;return {Type:'Line',StartTime:0,EndTime:2,Content:[{Type:'Vocal',Text:'one two',StartTime:0,EndTime:2}]};};
  const a=await p.FetchLyrics(track,3,()=>true,'','spotify:track:'+alias);
  assert.equal(a.Source.Provider,'AMLL');assert.equal(a.Source.UniqueTimings,2);
  assert.equal(a.Source.TrackId,alias);
  await p.FetchLyrics(track,3,()=>true,'','spotify:track:'+alias);
  assert.equal(requests,2);assert.equal(mxmRequests,1);
  assert.deepEqual(p.amllTrackIds(track.uri,track.uri),[id]);
});
test('a failing provider cannot suppress valid lyrics or poison recovery',async()=>{
  const p=await setup();globalThis.fetch=async()=>new Response(xml);
  let calls=0;globalThis.mxm=async()=>{calls++;throw new Error('temporary outage');};
  const a=await p.FetchLyrics(track,3,()=>true);
  assert.equal(a.Source.Provider,'AMLL');assert.match(a.Source.Warnings[0],/temporary outage/);
  await p.FetchLyrics(track,3,()=>true);assert.equal(calls,2);
});
test('stale results cannot be returned for the new song',async()=>{
  const p=await setup();globalThis.fetch=async()=>new Response(xml);globalThis.mxm=async()=>undefined;
  await assert.rejects(p.FetchLyrics(track,3,()=>false),/Track changed/);
});
