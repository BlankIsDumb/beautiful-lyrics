import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFixture, fakeCaches, settle, storage } from './cache-fixture.mjs';
const load = await compileFixture("export * from './Extension/Spices/Spicetify/Services/Player/AdditionalProviders.ts'; export * from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts'; export * from './Extension/Spices/Spicetify/Services/Player/LyricsProviders.ts'; export * from './Extension/Spices/Spicetify/Services/Player/LyricsCache.ts'; export * from './Extension/Spices/Spicetify/Services/Cache.ts';");
const storeName='BeautifulLyricsLocal_Spicy',tokenKey='BeautifulLyricsLocal/SpicyToken',day=86400000;
const id='0123456789012345678901',other='1123456789012345678901';
const track={uri:'spotify:track:'+id,name:'song',artists:[{name:'artist'}],album:{name:'album'}};
const body=(text='hello')=>({Type:'Static',Lines:[{Text:text}],source:'spotify',UploadAttribution:{Uploader:{username:'Uploader',url:'https://spicylyrics.org/user/uploader'},Maker:{username:'Maker',url:'https://elsewhere.test/maker'}}});
const response=(text='hello')=>Response.json({Status:200,Body:body(text)});
async function setup() {
 globalThis.caches=fakeCaches();storage();localStorage.setItem(tokenKey,'one');
 localStorage.setItem('BeautifulLyricsLocal/Behavior',JSON.stringify({providers:{Spotify:false,Musixmatch:false,AMLL:false,LRCLIB:false,Spicy:true}}));
 globalThis.fetch=async()=>response();return load();
}
const entry=(Content,extra={})=>({CacheVersion:1,StoredAt:Date.now(),ExpiresAt:Date.now()+14*day,Content,...extra});
const credits={Source:'spotify',People:[{Name:'Uploader',URL:'https://spicylyrics.org/user/uploader'},{Name:'Maker'}]};

test('Spicy disk hits survive module restart and preserve sanitized Attribution through provider selection',async()=>{
 let p=await setup(),calls=0;
 globalThis.fetch=async()=>{calls++;const data=body();data.source=42;data.UploadAttribution.Uploader.username=123;return Response.json({Status:200,Body:data})};
 const first=await p.FetchSpicy(id,3,()=>true);assert.equal(first.Attribution.Source,'42');assert.equal(first.Attribution.People[0].Name,'123');
 const stored=caches.item(storeName,'/'+id);assert.equal(stored.Content.Attribution.Source,'42');assert.equal(stored.Content.Attribution.People[1].URL,undefined);
 // Simulate a persisted, string-shaped unsafe URL. Read validation accepts the
 // credit shape, while the read sanitizer must discard the link before display.
 stored.Content.Attribution.People.push({Name:'Other credit',URL:'javascript:alert(1)'});caches.seed(storeName,'/'+id,stored);
 p=await load();const lookup=await p.FetchLyricLookup(track,3,()=>true);const hit=lookup.Candidates[0];
 assert.equal(hit.Source.Provider,'Spicy');assert.equal(calls,1);assert.equal(hit.Attribution.Source,'42');
 assert.deepEqual(hit.Attribution.People,[{Name:'123',URL:'https://spicylyrics.org/user/uploader'},{Name:'Maker',URL:undefined},{Name:'Other credit',URL:undefined}]);
 assert.deepEqual((await p.GetLyricsCacheCounts()).Spicy,1);
});

test('malformed Spicy Attribution is deleted as a miss and the provider still fetches',async()=>{
 for(const attribution of [undefined,null,{}, {Source:1,People:[]},{Source:'x',People:{}},{Source:'x',People:[null]},{Source:'x',People:[{Name:12}]},{Source:'x',People:[{Name:'name',URL:123}]}]) {
  const p=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return response()};
  caches.seed(storeName,'/'+id,entry({Type:'Static',Lines:[{Text:'stale'}],Attribution:attribution}));
  const lyrics=await p.FetchSpicy(id,3,()=>true);assert.equal(calls,1);assert.equal(lyrics.Lines[0].Text,'hello');assert.equal(lyrics.Attribution.People[0].Name,'Uploader');
  assert.ok(caches.operations.some(([op,name])=>op==='delete'&&name===storeName));
 }
});

test('Spicy HTTP 404 is stored for one day and hit reads do not extend it',async()=>{
 const p=await setup(),now=Date.now;let calls=0,time=Date.parse('2026-01-31T23:59:00Z');
 try {
  Date.now=()=>time;globalThis.fetch=async()=>{calls++;return new Response('',{status:404})};
  assert.equal(await p.FetchSpicy(id,3,()=>true),undefined);const first=caches.item(storeName,'/'+id);assert.equal(first.Content,false);assert.equal(first.ExpiresAt-first.StoredAt,day);
  time+=day-1;assert.equal(await p.FetchSpicy(id,3,()=>true),undefined);assert.equal(calls,1);assert.deepEqual(caches.item(storeName,'/'+id),first);
  time++;await p.FetchSpicy(id,3,()=>true);assert.equal(calls,2);assert.equal(caches.item(storeName,'/'+id).ExpiresAt,time+day);
 } finally {Date.now=now;}
});

test('Spicy 200 bodies that fail validation are never stored as not-found',async()=>{
 for(const invalid of [undefined,null,{Type:'Static',Lines:[]},{Type:'Line',Content:[]}]) {
  const p=await setup();globalThis.fetch=async()=>Response.json({Status:200,Body:invalid});
  assert.equal(await p.FetchSpicy(id,3,()=>true),undefined);assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);
 }
 const p=await setup();globalThis.fetch=async()=>Response.json({Status:200,Body:{Type:'Line',Content:[{Type:'Vocal',Text:'bad timing',StartTime:2,EndTime:1}]}});
 await assert.rejects(p.FetchSpicy(id,3,()=>true),/Invalid lyric timing/);assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);
 globalThis.fetch=async()=>response();assert.equal((await p.FetchSpicy(id,3,()=>true)).Type,'Static');assert.equal((await p.GetLyricsCacheCounts()).Spicy,1);
});

test('token rotation clears disk before new reads and removal clears disk without a request',async()=>{
 const p=await setup();await p.FetchSpicy(id,3,()=>true);let begin,release,calls=0;const began=new Promise(resolve=>{begin=resolve});
 globalThis.fetch=async(url,options)=>{
  calls++;if(url.endsWith(other)){begin();return new Promise(resolve=>{release=resolve})}
  assert.equal(options.headers.Authorization,'Bearer two');return response('new credential');
 };
 const pending=p.FetchSpicy(other,3,()=>true);await began;p.SetSpicyToken('two');
 // This immediate read must wait for disk deletion, rather than serving the old
 // cached id under the newly saved credential.
 assert.equal((await p.FetchSpicy(id,3,()=>true)).Lines[0].Text,'new credential');
 release(response('old credential'));await assert.rejects(pending,/Provider settings or track changed/);
 assert.equal(caches.item(storeName,'/'+other),undefined);assert.equal(caches.item(storeName,'/'+id).Content.Lines[0].Text,'new credential');assert.equal(calls,2);
 p.SetSpicyToken('');await settle();assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);assert.equal(await p.FetchSpicy(id,3,()=>true),undefined);assert.equal(calls,2);assert.equal(localStorage.getItem(tokenKey),null);
});

test('rotating away and back uses the store generation to block an old in-flight write',async()=>{
 const p=await setup();let begin,release;const began=new Promise(resolve=>{begin=resolve});globalThis.fetch=()=>{begin();return new Promise(resolve=>{release=resolve})};
 const pending=p.FetchSpicy(id,3,()=>true);await began;
 p.SetSpicyToken('two');p.SetSpicyToken('one');await settle();release(response('old generation'));
 await pending;assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);assert.equal(localStorage.getItem(tokenKey),'one');
});

test('failed token-store deletion cannot serve the previous credential cache',async()=>{
 const p=await setup();await p.FetchSpicy(id,3,()=>true);caches.faults.add('delete');p.SetSpicyToken('two');let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer two');return response('new credential')};
 assert.equal((await p.FetchSpicy(id,3,()=>true)).Lines[0].Text,'new credential');assert.equal(calls,1);
});

test('Spicy count and scoped clear use disk and preserve other providers, cooldowns and tokens',async()=>{
 const p=await setup();localStorage.setItem('BeautifulLyricsLocal/SpicyCooldown','0');localStorage.setItem('BeautifulLyricsLocal/MusixmatchToken','mxm');
 await p.FetchSpicy(id,3,()=>true);await p.GetExpireStore('BeautifulLyricsLocal_LRCLIB',1,{Duration:14,Unit:'Days'}).SetItem('other',false);
 const before=caches.operations.length;const counts=await p.GetLyricsCacheCounts();assert.equal(counts.Spicy,1);assert.equal(counts.LRCLIB,1);
 assert.ok(caches.operations.slice(before).every(([op])=>['stores','open','keys'].includes(op)));
 let reloads=0;assert.deepEqual(await p.ClearLyricsCache('Spicy',()=>reloads++),{removed:1,failed:false});assert.equal(reloads,1);assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);assert.equal((await p.GetLyricsCacheCounts()).LRCLIB,1);
 assert.equal(localStorage.getItem(tokenKey),'one');assert.equal(localStorage.getItem('BeautifulLyricsLocal/MusixmatchToken'),'mxm');assert.equal(localStorage.getItem('BeautifulLyricsLocal/SpicyCooldown'),'0');
 await p.ClearLyricsCache('All',()=>reloads++);assert.equal(reloads,2);assert.equal(localStorage.getItem('BeautifulLyricsLocal/SpicyCooldown'),null);assert.equal(localStorage.getItem(tokenKey),'one');
});

test('Spicy hits expire at fourteen absolute days, never sliding toward or past thirty days from StoredAt',async()=>{
 const p=await setup(),now=Date.now;let calls=0,time=Date.parse('2026-03-08T06:59:59Z');globalThis.fetch=async()=>{calls++;return response('fetch '+calls)};
 try {
  Date.now=()=>time;await p.FetchSpicy(id,3,()=>true);const first=caches.item(storeName,'/'+id);assert.equal(first.ExpiresAt-first.StoredAt,14*day);
  time+=14*day-1;assert.equal((await p.FetchSpicy(id,3,()=>true)).Lines[0].Text,'fetch 1');assert.equal(calls,1);assert.deepEqual(caches.item(storeName,'/'+id),first);
  time++;assert.equal((await p.FetchSpicy(id,3,()=>true)).Lines[0].Text,'fetch 2');assert.equal(calls,2);
  time=first.StoredAt+31*day;assert.equal((await p.FetchSpicy(id,3,()=>true)).Lines[0].Text,'fetch 3');assert.equal(calls,3);
  for(const entry of [first,caches.item(storeName,'/'+id)]) {assert.equal(entry.ExpiresAt-entry.StoredAt,14*day);assert.ok(entry.ExpiresAt<=entry.StoredAt+30*day);}
  assert.equal(caches.operations.filter(([op,name])=>op==='delete'&&name===storeName).length,2);
 } finally {Date.now=now;}
});

test('Spicy disk participates in expiry/version/shape pruning and the default 2000-entry cap',async()=>{
 const p=await setup(),lyrics={Type:'Static',Lines:[{Text:'saved'}],Attribution:credits};const start=Date.now()-10000;
 for(let i=0;i<2001;i++)caches.seed(storeName,'/'+i,entry(lyrics,{StoredAt:start+i}));
 caches.seed(storeName,'/expired',entry(false,{ExpiresAt:0}));caches.seed(storeName,'/version',entry(lyrics,{CacheVersion:0}));caches.seed(storeName,'/credits',entry({...lyrics,Attribution:null}));
 await p.SweepExpireStores(async()=>{});assert.equal((await p.GetLyricsCacheCounts()).Spicy,2000);assert.equal(caches.item(storeName,'/0'),undefined);assert.equal(caches.item(storeName,'/1').Content.Lines[0].Text,'saved');
 for(const key of ['expired','version','credits'])assert.equal(caches.item(storeName,'/'+key),undefined);
});

test('Spicy transport, HTTP failures and non-200 relay body statuses remain uncached',async()=>{
 for(const failure of ['relay',500,429,'body-status']) {
  const p=await setup();globalThis.fetch=async()=>{if(failure==='relay')throw Error('private transport details');return failure==='body-status'?Response.json({Status:503}):new Response('',{status:failure})};
  await assert.rejects(p.FetchSpicy(id,3,()=>true),failure==='relay'?/Local Spicy relay unavailable/:/Provider returned/);assert.equal((await p.GetLyricsCacheCounts()).Spicy,0);assert.equal(localStorage.getItem(tokenKey),'one');
 }
});
