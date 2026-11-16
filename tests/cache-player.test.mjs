import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { compileFixture, settle, storage } from './cache-fixture.mjs';
const load = await compileFixture("export * from './Extension/Spices/Spicetify/Services/Cache.ts';");
const source = readFileSync('Extension/Spices/Spicetify/Services/Player/mod.ts','utf8');
const block = source.slice(source.indexOf('// Handle our Lyrics'),source.indexOf('// Wait for Spotify to be ready')).replaceAll(/export /g,'');
const {code} = transformSync(block+`;return {ReloadLyrics,state:()=>({lyrics:SongLyrics,error:SongLyricsError,outcomes:SongLyricsOutcomes,loaded:HaveSongLyricsLoaded})};`,{loader:'ts'});
const create = new Function('GetMemoryStore','FetchLyricLookup','TransformProviderLyrics','deps',`
 const {Song,SpotifyPlayer,SongLyricsLoadedSignal,ShowNotification}=deps;
 const PlayerMaid={Give(){},IsDestroyed:()=>false},lyricRequestGate={change:()=>Promise.resolve(true)};
 const OnProviderSettingsChanged=()=>{},OnRichSyncSettingsChanged=()=>{},GetRichSyncSettings=()=>({}),GetBehaviorSettings=()=>({fetchMode:'change'});
 const lyricsRequired=()=>true,SpotifyHistory={location:{pathname:'/BeautifulLyrics/Page'}},SongDetails=undefined,SelectCompensatedLyrics=choices=>choices[0];
 ${code}`);
const candidate={Type:'Static',Lines:[{Text:'hello'}],Source:{CacheKey:'key',Provider:'Spotify',Warnings:[],Candidates:[]}};
async function fixture(lookup,transform=async lyrics=>structuredClone(lyrics)){
 storage();const cache=await load();let notifications=0,signals=0;
 const player=create(cache.GetMemoryStore,lookup,transform,{Song:{Type:'Streamed',Uri:'track',Duration:3},SpotifyPlayer:{data:{item:{}}},SongLyricsLoadedSignal:{Fire(){signals++}},ShowNotification(){notifications++}});
 return {...player,cache,notifications:()=>notifications,signals:()=>signals};
}

test('player uses no-lyrics for none/partial failure and errors only for all failed, without toasts',async()=>{
 for(const outcomes of [[{Provider:'Spotify',State:'none'}],[{Provider:'Spotify',State:'none'},{Provider:'Spicy',State:'failed',Reason:'relay unavailable'}],[{Provider:'Spotify',State:'failed',Reason:'unavailable'}]]) {
  const error=outcomes.every(o=>o.State==='failed')?'unavailable':undefined;
  const p=await fixture(async()=>({Candidates:[],Outcomes:outcomes,Error:error}));p.ReloadLyrics();await settle();
  assert.equal(p.state().loaded,true);assert.equal(p.state().error,error);assert.deepEqual(p.state().outcomes,outcomes);assert.equal(p.notifications(),0);assert.equal(p.signals(),1);
 }
});

test('prepared lyrics reuse memory and All clear invalidates an in-flight transform',async()=>{
 let calls=0;const p=await fixture(async()=>({Candidates:[candidate],Outcomes:[{Provider:'Spotify',State:'found'}]}),async lyrics=>{calls++;return structuredClone(lyrics)});
 p.ReloadLyrics();await settle();p.ReloadLyrics();await settle();assert.equal(calls,1);assert.equal(p.state().lyrics.Type,'Static');
 let release,begin;const began=new Promise(resolve=>{begin=resolve});
 const q=await fixture(async()=>({Candidates:[candidate],Outcomes:[{Provider:'Spotify',State:'found'}]}),()=>{begin();return new Promise(resolve=>{release=resolve})});
 q.ReloadLyrics();await began;await q.cache.ClearCacheEntries(['Transformed']);release(structuredClone(candidate));await settle();
 assert.equal((await q.cache.CountCacheEntries(['Transformed'])).Transformed,0);assert.equal(q.notifications(),0);
});

test('local preparation failure keeps a none provider as partial failure; all failed is an error',async()=>{
 for(const all of [false,true]) {
  const outcomes=[{Provider:'Spotify',State:'found'},...(!all?[{Provider:'AMLL',State:'none'}]:[])];
  const p=await fixture(async()=>({Candidates:[candidate],Outcomes:outcomes}),async()=>{throw Error('unsupported fixture')});
  p.ReloadLyrics();await settle();assert.equal(!!p.state().error,all);assert.equal(p.state().outcomes[0].State,'failed');assert.equal(p.notifications(),0);
 }
});
