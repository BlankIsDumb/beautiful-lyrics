import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {convertSpotify} from '../Extension/Spices/Spicetify/Services/Player/SpotifyLyrics.mjs';
const body={lyrics:{syncType:'LINE_SYNCED',lines:[{words:'a',startTimeMs:'1000',endTimeMs:'0'},{words:'',startTimeMs:'2000'},{words:'b',startTimeMs:'3000'}]}};
test('Spotify parser preserves blank boundaries and converts milliseconds without word sync',()=>{
 const parsed=convertSpotify(body,5);assert.equal(parsed.Type,'Line');assert.deepEqual(parsed.Content.map(l=>[l.StartTime,l.EndTime]),[[1,2],[3,5]]);
 assert.equal(convertSpotify({lyrics:{syncType:'UNSYNCED',lines:[{words:'plain'}]}},5).Type,'Static');
 assert.throws(()=>convertSpotify({lyrics:{syncType:'WORD_SYNCED',lines:[]}},5),/Unsupported/);
 assert.throws(()=>convertSpotify({lyrics:{syncType:'LINE_SYNCED',lines:[{words:'x',startTimeMs:'bad'}]}},5),/timing/);
});
const code=await build({entryPoints:['Extension/Spices/Spicetify/Services/Player/SpotifyProvider.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'mocks',setup(b){
 b.onResolve({filter:/Session\.ts$/},()=>({path:'session',namespace:'fake'}));b.onResolve({filter:/Cache\.ts$/},()=>({path:'cache',namespace:'fake'}));
 b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path==='session'?'export const Spotify={CosmosAsync:{get:(...args)=>globalThis.request(...args)}}':'export const GetExpireStore=()=>({GetItem:async k=>globalThis.cache.get(k),SetItem:async(k,v)=>globalThis.cache.set(k,v)})'}));
}}]});let serial=0;
async function setup(){globalThis.cache=new Map();const s=new Map();globalThis.localStorage={getItem:k=>s.get(k),setItem:(k,v)=>s.set(k,v)};return import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text+`\n//${serial++}`).toString('base64'))}
const id='0123456789012345678901';
test('Spotify caches success/404, isolates quota failure and drops stale responses',async()=>{
 let p=await setup(),calls=0;globalThis.request=async url=>{calls++;assert.match(url,/spclient\.wg\.spotify\.com\/color-lyrics/);return body};
 await p.FetchSpotify(id,5,()=>true);await p.FetchSpotify(id,5,()=>true);assert.equal(calls,1);
 p=await setup();globalThis.request=async()=>{throw {status:404}};assert.equal(await p.FetchSpotify(id,5,()=>true),undefined);assert.equal(cache.get(id),false);
 p=await setup();calls=0;globalThis.request=async()=>{calls++;throw {status:429}};await assert.rejects(p.FetchSpotify(id,5,()=>true),/429/);await assert.rejects(p.FetchSpotify(id,5,()=>true),/cooling/);assert.equal(calls,1);assert.equal(cache.size,0);
 p=await setup();let current=true;globalThis.request=async()=>{current=false;return body};await assert.rejects(p.FetchSpotify(id,5,()=>current),/Track changed/);assert.equal(cache.size,0);
});
