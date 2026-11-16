import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFixture, fakeCaches, settle, storage } from './cache-fixture.mjs';
const load = await compileFixture("export * from './Extension/Spices/Spicetify/Services/Player/LyricsProviders.ts';export * from './Extension/Spices/Spicetify/Services/Player/SpotifyProvider.ts';export * from './Extension/Spices/Spicetify/Services/Player/AdditionalProviders.ts';export * from './Extension/Spices/Spicetify/Services/Player/Musixmatch.ts';export * from './Extension/Spices/Spicetify/Services/Player/LyricsCache.ts';");
const id='0123456789012345678901',track={uri:'spotify:track:'+id,name:'song',artists:[{name:'artist'}],album:{name:'album'}};
const spotifyBody={lyrics:{syncType:'UNSYNCED',lines:[{words:'hello'}]}};
const message=(body,status=200)=>({message:{header:{status_code:status},body}});
const macro=(calls={})=>message({macro_calls:{'matcher.track.get':message({track:{track_spotify_id:id}}),...calls}});
async function setup(providers={Spotify:true,Musixmatch:false,AMLL:false,LRCLIB:false,Spicy:false}){
 globalThis.caches=fakeCaches();storage();localStorage.setItem('BeautifulLyricsLocal/Behavior',JSON.stringify({providers}));
 localStorage.setItem('BeautifulLyricsLocal/MusixmatchToken','fixture-token');globalThis.spotifyRequest=async()=>spotifyBody;globalThis.fetch=async()=>new Response('',{status:404});
 return load();
}

test('corrupt/wrong-shape Spotify cache misses still fetch and write failure still returns lyrics',async()=>{
 for(const entry of ['{broken',{CacheVersion:1,ExpiresAt:Date.now()+10000,Content:{wrong:'shape'}}]) {
  const p=await setup();let calls=0;globalThis.spotifyRequest=async()=>{calls++;return spotifyBody};caches.seed('BeautifulLyricsLocal_Spotify','/'+id,entry);
  caches.faults.add('put');const warn=console.warn;console.warn=()=>{};
  try {assert.equal((await p.FetchSpotify(id,3,()=>true)).Type,'Static');assert.equal(calls,1);} finally {console.warn=warn;}
  await settle();assert.equal(caches.stores.get('BeautifulLyricsLocal_Spotify').size,0);
 }
});

test('Spotify parse failure/empty conversion are not persisted; genuine 404 uses one day',async()=>{
 let p=await setup();globalThis.spotifyRequest=async()=>({lyrics:{syncType:'WORD_SYNCED',lines:[]}});
 await assert.rejects(p.FetchSpotify(id,3,()=>true),/Unsupported/);assert.equal(caches.stores.get('BeautifulLyricsLocal_Spotify')?.size||0,0);
 p=await setup();globalThis.spotifyRequest=async()=>({lyrics:{syncType:'UNSYNCED',lines:[]}});assert.equal(await p.FetchSpotify(id,3,()=>true),undefined);assert.equal(caches.stores.get('BeautifulLyricsLocal_Spotify')?.size||0,0);
 p=await setup();globalThis.spotifyRequest=async()=>{throw {status:404}};const start=Date.now();await p.FetchSpotify(id,3,()=>true);
 const entry=caches.item('BeautifulLyricsLocal_Spotify','/'+id);assert.equal(entry.Content,false);assert.ok(entry.ExpiresAt>=start+86400000&&entry.ExpiresAt<=Date.now()+86400000);
});

test('Musixmatch mismatch is cached not-found for a day and a second play makes no request',async()=>{
 const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});let calls=0;
 globalThis.musixmatchRequest=async()=>{calls++;return message({macro_calls:{'matcher.track.get':message({track:{track_spotify_id:'other'}})}})};
 const start=Date.now();const first=await p.FetchLyricLookup(track,3,()=>true,'KNOWN-ISRC');assert.equal(first.Candidates.length,0);assert.equal(first.Outcomes.find(o=>o.Provider==='Musixmatch').State,'none');
 const entry=caches.item('BeautifulLyricsLocal_Musixmatch','/'+id);assert.equal(entry.Content,false);assert.ok(entry.ExpiresAt>=start+86400000&&entry.ExpiresAt<=Date.now()+86400000);
 await p.FetchLyricLookup(track,3,()=>true,'KNOWN-ISRC');assert.equal(calls,1);
});

test('Musixmatch transient richsync/subtitle fallbacks stay usable but are not persisted',async()=>{
 for(const failing of ['track.richsync.get','track.subtitles.get']) {
  const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});
  globalThis.musixmatchRequest=async()=>macro({[failing]:message({},500),'track.lyrics.get':message({lyrics:{lyrics_body:'fallback'}})});
  const result=await p.FetchLyricLookup(track,3,()=>true);assert.equal(result.Candidates[0].Type,'Static');assert.equal(caches.stores.get('BeautifulLyricsLocal_Musixmatch').size,0);
 }
 const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});
 globalThis.musixmatchRequest=async()=>macro({'track.richsync.get':message({},500)});
 const failed=await p.FetchLyricLookup(track,3,()=>true);assert.match(failed.Error,/temporarily unavailable/);assert.equal(caches.stores.get('BeautifulLyricsLocal_Musixmatch').size,0);
});

test('Spotify, Musixmatch, AMLL, LRCLIB and Spicy block in-flight cache write-back after clear',async()=>{
 for(const provider of ['Spotify','Musixmatch','AMLL','LRCLIB','Spicy']) {
  const p=await setup(Object.fromEntries(['Spotify','Musixmatch','AMLL','LRCLIB','Spicy'].map(name=>[name,name===provider])));
  localStorage.setItem('BeautifulLyricsLocal/SpicyToken','fixture');let release,begin;
  const began=new Promise(resolve=>{begin=resolve});const waiting=()=>{begin();return new Promise(resolve=>{release=resolve})};
  globalThis.spotifyRequest=waiting;globalThis.musixmatchRequest=waiting;globalThis.fetch=waiting;
  const lookup=p.FetchLyricLookup(track,3,()=>true);await began;let reloads=0;await p.ClearLyricsCache(provider,()=>reloads++);
  if(provider==='Spotify')release(spotifyBody);
  else if(provider==='Musixmatch')release(macro({'track.lyrics.get':message({lyrics:{lyrics_body:'found'}})}));
  else if(provider==='LRCLIB')release(Response.json({plainLyrics:'hello'}));
  else if(provider==='Spicy')release(Response.json({Status:200,Body:{Type:'Static',Lines:[{Text:'hello'}]}}));
  else release(new Response('',{status:404}));
  await lookup;const counts=await p.GetLyricsCacheCounts();assert.equal(counts[provider],0,provider);assert.equal(reloads,1);
 }
});

test('canonical alias lookups keep the generation captured before clear',async()=>{
 const p=await setup(),alias='1123456789012345678901';let reject,begin,calls=0;
 const began=new Promise(resolve=>{begin=resolve});
 globalThis.spotifyRequest=async()=>{calls++;if(calls===1){begin();return new Promise((_,fail)=>{reject=fail})}return spotifyBody};
 const lookup=p.FetchLyricLookup(track,3,()=>true,'','spotify:track:'+alias);await began;await p.ClearLyricsCache('Spotify',()=>{});reject({status:404});
 const result=await lookup;assert.equal(result.Candidates[0].Source.TrackId,alias);assert.equal(calls,2);assert.equal((await p.GetLyricsCacheCounts()).Spotify,0);
});

test('an empty-ISRC ID mismatch stays non-cacheable until metadata can establish the recording',async()=>{
 const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});
 globalThis.musixmatchRequest=async()=>message({macro_calls:{'matcher.track.get':message({track:{track_spotify_id:'other'}})}});
 const result=await p.FetchLyricLookup(track,3,()=>true);assert.equal(result.Candidates.length,0);assert.equal(result.Error,undefined);assert.equal(caches.stores.get('BeautifulLyricsLocal_Musixmatch').size,0);
});

test('lyrics.get transient statuses never persist a miss or a usable subtitle fallback',async()=>{
 for(const subtitles of [false,true]) {
  const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});
  globalThis.musixmatchRequest=async()=>macro({'track.lyrics.get':message({},503),...(subtitles?{'track.subtitles.get':message({subtitle_list:[{subtitle:{subtitle_body:JSON.stringify([{text:'fallback',time:{total:0}}])}}]})}:{})});
  const result=await p.FetchLyricLookup(track,3,()=>true);
  if(subtitles)assert.equal(result.Candidates[0].Type,'Line');else assert.match(result.Error,/temporarily unavailable/);
  assert.equal(caches.stores.get('BeautifulLyricsLocal_Musixmatch').size,0);
 }
});

test('lyrics.get 404 and 200 without lyrics remain authoritative one-day misses',async()=>{
 for(const status of [200,404]) {
  const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false});globalThis.musixmatchRequest=async()=>macro({'track.lyrics.get':message({},status)});
  const start=Date.now(),result=await p.FetchLyricLookup(track,3,()=>true);assert.equal(result.Error,undefined);assert.equal(result.Candidates.length,0);
  const entry=caches.item('BeautifulLyricsLocal_Musixmatch','/'+id);assert.equal(entry.Content,false);assert.ok(entry.ExpiresAt>=start+86400000&&entry.ExpiresAt<=Date.now()+86400000);
 }
});

test('a lookup after Clear uses a new Musixmatch pending key and only the new generation populates cache',async()=>{
 const p=await setup({Spotify:false,Musixmatch:true,AMLL:false,LRCLIB:false,Spicy:false}),now=Date.now;let release,begin,calls=0,time=now();
 const began=new Promise(resolve=>{begin=resolve});globalThis.musixmatchRequest=async()=>{calls++;if(calls===1){begin();return new Promise(resolve=>{release=resolve})}return macro({'track.lyrics.get':message({lyrics:{lyrics_body:'new'}})})};
 try {
  Date.now=()=>time;
  const before=p.FetchLyricLookup(track,3,()=>true);await began;await p.ClearLyricsCache('Musixmatch',()=>{});
  const after=p.FetchLyricLookup(track,3,()=>true);time+=3000;release(macro({'track.lyrics.get':message({lyrics:{lyrics_body:'old'}})}));
  await Promise.all([before,after]);assert.equal(calls,2);assert.equal(caches.item('BeautifulLyricsLocal_Musixmatch','/'+id).Content.Lines[0].Text,'new');
 } finally {Date.now=now;}
});

test('All resets AMLL in-memory retry before one reload; a provider-only clear leaves retry intact',async()=>{
 const p=await setup({Spotify:false,Musixmatch:false,AMLL:true,LRCLIB:false,Spicy:false});let calls=0,reloads=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:503})};
 await p.FetchLyricLookup(track,3,()=>true);await p.ClearLyricsCache('AMLL',()=>reloads++);
 const waiting=await p.FetchLyricLookup(track,3,()=>true);assert.match(waiting.Error,/cooling down/);assert.equal(calls,1);
 await p.ClearLyricsCache('All',()=>reloads++);assert.equal(reloads,2);assert.equal(calls,1);assert.equal(localStorage.getItem('BeautifulLyricsLocal/MusixmatchToken'),'fixture-token');
 globalThis.fetch=async()=>{calls++;return new Response('',{status:404})};const result=await p.FetchLyricLookup(track,3,()=>true);assert.equal(result.Error,undefined);assert.equal(calls,2);
});
