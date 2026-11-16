import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFixture, fakeCaches, settle, storage } from './cache-fixture.mjs';
const load = await compileFixture("export * from './Extension/Spices/Spicetify/Services/Cache.ts'; export * from './Extension/Spices/Spicetify/Services/Player/LyricsCache.ts';");
const day = 86_400_000;
async function setup() { globalThis.caches = fakeCaches(); storage(); return load(); }
const envelope = (Content, extra = {}) => ({ CacheVersion: 1, ExpiresAt: Date.now() + day, Content, ...extra });
const store = (m, name = 'test', days = 14, cap) => m.GetExpireStore(name, 1, {Duration:days,Unit:'Days'}, undefined, value => value === false || typeof value?.value === 'string', cap);

test('registering stores does no IO, scheduling or localStorage work at import', async () => {
  const m = await setup(); store(m); m.GetMemoryStore('Transformed',40);
  assert.deepEqual(caches.operations,[]);
});

test('absolute day arithmetic preserves time at Jan 31, month-end and DST boundaries; false is one day', async () => {
  const m = await setup(), normal = store(m), mxm = store(m,'mxm',30), now = Date.now;
  try {
    for (const date of ['2026-01-31T23:57:43Z','2026-02-28T00:05:01Z','2026-03-08T06:59:59Z','2026-11-01T05:59:59Z']) {
      Date.now = () => Date.parse(date);
      await normal.SetItem('hit',{value:'yes'}); await mxm.SetItem('hit',{value:'yes'});
      await normal.SetItem('none',false); await mxm.SetItem('none',false);
      assert.equal(caches.item('test','/hit').ExpiresAt,Date.now()+14*day);
      assert.equal(caches.item('mxm','/hit').ExpiresAt,Date.now()+30*day);
      for(const name of ['test','mxm']) assert.equal(caches.item(name,'/none').ExpiresAt,Date.now()+day);
    }
  } finally { Date.now = now; }
});

test('corrupt JSON, bad envelope/content, old versions and expired records miss and are removed; legacy expiry stays',async()=>{
  const m = await setup(), cache = store(m);
  const invalid = ['{bad',null,[],{},envelope('wrong'),envelope({value:'v'},{CacheVersion:0}),envelope(false,{ExpiresAt:Date.now()-1}),envelope({value:'v'},{ExpiresAt:'tomorrow'}),envelope({value:'v'},{StoredAt:'yesterday'})];
  for(let i=0;i<invalid.length;i++) {
    caches.seed('test','/bad'+i,invalid[i]); assert.equal(await cache.GetItem('bad'+i),undefined);
  }
  const legacy = envelope({value:'legacy'},{ExpiresAt:Date.now()+123456}); caches.seed('test','/legacy',legacy);
  assert.deepEqual(await cache.GetItem('legacy'),{value:'legacy'});
  await settle(); assert.equal(caches.stores.get('test').size,1); assert.equal(caches.item('test','/legacy').ExpiresAt,legacy.ExpiresAt);
});

test('Cache API failures are misses and write rejection only warns once per store while returning content',async()=>{
  const m = await setup(), cache = store(m);
  for(const failure of ['open','match']) { caches.faults.add(failure); assert.equal(await cache.GetItem('x'),undefined); caches.faults.clear(); }
  const warn=console.warn, warnings=[];console.warn=(...args)=>warnings.push(args);
  try { caches.faults.add('put'); for(let i=0;i<2;i++) assert.deepEqual(await cache.SetItem('x',{value:'ok'}),{value:'ok'}); }
  finally { console.warn=warn; }
  assert.equal(warnings.length,1);assert.equal(caches.stores.get('test').size,0);
});

test('sweep removes invalid/expired/versioned entries, evicts oldest stored first, yields and is idempotent',async()=>{
  const m=await setup();store(m,'test',14,2);
  caches.seed('test','/expired',envelope(false,{ExpiresAt:0}));caches.seed('test','/old-version',envelope(false,{CacheVersion:0}));caches.seed('test','/broken','!');
  for(let i=24;i>=0;i--)caches.seed('test','/live'+i,envelope({value:'ok'},{StoredAt:i+1}));
  let yields=0;await m.SweepExpireStores(async()=>{yields++;});
  assert.deepEqual([...caches.stores.get('test').keys()].map(k=>new URL(k).pathname),['/live24','/live23']);assert.ok(yields>0);
  const deleted=caches.operations.filter(([op])=>op==='delete').map(([, ,key])=>new URL(key).pathname);
  assert.deepEqual(deleted.slice(0,5),['/expired','/old-version','/broken','/live0','/live1']);
  await m.SweepExpireStores(async()=>{});assert.equal(caches.operations.filter(([op])=>op==='delete').length,deleted.length);
});

test('clear/count scopes include memory and metadata only for All, preserve credentials, reset only cooldowns and reload once',async()=>{
  const m=await setup(), raw=['Spotify','Musixmatch','AMLL','LRCLIB','Spicy'];
  for(const name of raw){const s=store(m,'BeautifulLyricsLocal_'+name);await s.SetItem('x',false);}
  await store(m,'Player_TrackInformation').SetItem('x',{value:'metadata'});
  m.GetMemoryStore('Transformed',40).SetItem('x','prepared');
  for(const name of ['Spotify','Musixmatch','LRCLIB','Spicy'])localStorage.setItem('BeautifulLyricsLocal/'+name+'Cooldown','123');
  for(const name of ['Musixmatch','Spicy'])localStorage.setItem('BeautifulLyricsLocal/'+name+'Token','secret');
  let reloads=0;assert.deepEqual(await m.GetLyricsCacheCounts(),{All:7,Spotify:1,Musixmatch:1,AMLL:1,LRCLIB:1,Spicy:1});
  const before=caches.operations.length;await m.GetLyricsCacheCounts();assert.ok(caches.operations.slice(before).every(([op])=>['stores','open','keys'].includes(op)));
  assert.deepEqual(await m.ClearLyricsCache('Spotify',()=>reloads++),{removed:1,failed:false});assert.equal(reloads,1);
  assert.equal(localStorage.getItem('BeautifulLyricsLocal/SpotifyCooldown'),'123');assert.equal((await m.GetLyricsCacheCounts()).All,6);
  assert.deepEqual(await m.ClearLyricsCache('Spicy',()=>reloads++),{removed:1,failed:false});
  assert.deepEqual(await m.ClearLyricsCache('All',()=>reloads++),{removed:5,failed:false});assert.equal(reloads,3);
  for(const name of ['Spotify','Musixmatch','LRCLIB','Spicy'])assert.equal(localStorage.getItem('BeautifulLyricsLocal/'+name+'Cooldown'),null);
  for(const name of ['Musixmatch','Spicy'])assert.equal(localStorage.getItem('BeautifulLyricsLocal/'+name+'Token'),'secret');
  assert.equal((await m.GetLyricsCacheCounts()).All,0);
});

test('LRU is bounded at 40, reads refresh recency and All blocks old raw/transformed writes',async()=>{
  const m=await setup(), memory=m.GetMemoryStore('Transformed',40), raw=store(m,'BeautifulLyricsLocal_Spotify');
  for(let i=0;i<40;i++)memory.SetItem(String(i),i);
  memory.GetItem('0');memory.SetItem('40',40);assert.equal(memory.Count(),40);assert.equal(memory.GetItem('1'),undefined);assert.equal(memory.GetItem('0'),0);
  const rawGeneration=raw.GetGeneration(),memoryGeneration=memory.GetGeneration();
  const clear=m.ClearCacheEntries(['BeautifulLyricsLocal_Spotify','Transformed']);
  await raw.SetItem('late',{value:'old'},rawGeneration);memory.SetItem('late',10,memoryGeneration);await clear;
  assert.equal(await raw.GetItem('late'),undefined);assert.equal(memory.Count(),0);
});

test('clear waits for a put already writing and leaves no pre-clear result behind',async()=>{
  const m=await setup(), cache=store(m);const open=caches.open.bind(caches);let release,started;
  const began=new Promise(resolve=>{started=resolve});
  caches.open=async name=>{const c=await open(name),put=c.put;c.put=async(...args)=>{started();await new Promise(resolve=>{release=resolve});return put(...args)};return c;};
  const writing=cache.SetItem('old',{value:'old'},cache.GetGeneration());await began;
  const clearing=m.ClearCacheEntries(['test']);release();await Promise.all([writing,clearing]);
  assert.equal(await cache.GetItem('old'),undefined);
});

test('maintenance waits 60 seconds and idle, retires transformed disk once and supports cancellation',async()=>{
  const m=await setup();caches.seed('BeautifulLyricsLocal_Transformed','/old',envelope(false));
  const old={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,requestIdleCallback:globalThis.requestIdleCallback,cancelIdleCallback:globalThis.cancelIdleCallback};
  let timer,idle,delay;
  try {
    globalThis.setTimeout=(fn,ms)=>{timer=fn;delay=ms;return 99};globalThis.clearTimeout=()=>{};
    globalThis.requestIdleCallback=fn=>{idle=fn;return 100};globalThis.cancelIdleCallback=()=>{};
    const cancel=m.StartCacheMaintenance();m.StartCacheMaintenance();assert.equal(delay,60000);assert.deepEqual(caches.operations,[]);
    timer();assert.deepEqual(caches.operations,[]);idle();await settle();assert.equal(caches.stores.has('BeautifulLyricsLocal_Transformed'),false);
    cancel();assert.equal(caches.operations.filter(([op])=>op==='drop').length,1);
  } finally { Object.assign(globalThis,old); }
  const next=await setup();caches.seed('BeautifulLyricsLocal_Transformed','/old',envelope(false));
  let launch;globalThis.setTimeout=fn=>{launch=fn;return 1};globalThis.clearTimeout=()=>{};
  try { const cancel=next.StartCacheMaintenance();cancel();launch();await settle();assert.equal(caches.stores.has('BeautifulLyricsLocal_Transformed'),true); }
  finally { Object.assign(globalThis,old); }
});

test('unavailable counts and partial clear failures stay explicit and still reload once',async()=>{
 const m=await setup(),cache=store(m,'BeautifulLyricsLocal_Spotify');await cache.SetItem('one',{value:'1'});await cache.SetItem('two',{value:'2'});
 caches.faults.add('keys');assert.equal((await m.GetLyricsCacheCounts()).Spotify,undefined);caches.faults.clear();
 const open=caches.open.bind(caches);let deleted=0;
 caches.open=async name=>{const cache=await open(name),remove=cache.delete;cache.delete=async key=>{if(++deleted===2)throw Error('unavailable');return remove(key)};return cache;};
 let reloads=0;assert.deepEqual(await m.ClearLyricsCache('Spotify',()=>reloads++),{removed:1,failed:true});assert.equal(reloads,1);assert.equal(caches.stores.get('BeautifulLyricsLocal_Spotify').size,1);
});

test('missing Cache Storage and rejecting storage enumeration do not break reads, counts or clear',async()=>{
 for(const unavailable of ['missing','enumeration']) {
  const m=await setup(),cache=store(m,'BeautifulLyricsLocal_Spotify'),memory=m.GetMemoryStore('Transformed',40);
  await cache.SetItem('saved',{value:'saved'});memory.SetItem('prepared','memory');
  if(unavailable==='missing')delete globalThis.caches;
  else caches.faults.add('stores');
  assert.deepEqual(await cache.GetItem('saved'),unavailable==='missing'?undefined:{value:'saved'});
  const counts=await m.GetLyricsCacheCounts();assert.equal(counts.Spotify,undefined);assert.equal(counts.All,undefined);
  assert.equal((await m.CountCacheEntries(['Transformed'])).Transformed,1);
  let reloads=0;assert.deepEqual(await m.ClearLyricsCache('Spotify',()=>reloads++),{removed:0,failed:true});assert.equal(reloads,1);
  assert.deepEqual(await m.ClearLyricsCache('All',()=>reloads++),{removed:1,failed:true});assert.equal(reloads,2);assert.equal(memory.Count(),0);
 }
});

test('default disk cap preserves 2000 live entries and evicts only the oldest entry beyond it',async()=>{
 const m=await setup();store(m);
 for(let i=0;i<2000;i++)caches.seed('test','/'+i,envelope({value:String(i)},{StoredAt:i}));
 await m.SweepExpireStores(async()=>{});assert.equal(caches.stores.get('test').size,2000);assert.equal(caches.operations.filter(([op])=>op==='delete').length,0);
 caches.seed('test','/2000',envelope({value:'last'},{StoredAt:2000}));
 await m.SweepExpireStores(async()=>{});assert.equal(caches.stores.get('test').size,2000);assert.equal(caches.item('test','/0'),undefined);assert.equal(caches.item('test','/1').Content.value,'1');assert.equal(caches.item('test','/2000').Content.value,'last');
});

test('sweep yields by elapsed validation time rather than entry count',async()=>{
 const m=await setup();let elapsed=0,validated=0;const batches=[];
 m.GetExpireStore('heavy',1,{Duration:14,Unit:'Days'},undefined,value=>{elapsed+=5;validated++;return typeof value?.value==='string'});
 for(let i=0;i<3;i++)caches.seed('heavy','/'+i,envelope({value:'large timed song'}));
 await m.SweepExpireStores(async()=>{batches.push(validated)},()=>false,()=>elapsed);
 assert.deepEqual(batches.slice(0,3),[1,2,3]);assert.equal(caches.stores.get('heavy').size,3);
});

test('cancelling mid-sweep stops before remaining entries and stores',async()=>{
 const m=await setup();store(m,'first');store(m,'second');let cancelled=false,time=0;
 for(let i=0;i<3;i++)caches.seed('first','/'+i,envelope(false,{ExpiresAt:0}));caches.seed('second','/old',envelope(false,{ExpiresAt:0}));
 await m.SweepExpireStores(async()=>{cancelled=true},()=>cancelled,()=>time+=5);
 assert.equal(caches.stores.get('first').size,2);assert.equal(caches.stores.get('second').size,1);assert.equal(caches.operations.filter(([op])=>op==='delete').length,1);
});

test('Clear during a sweep invalidates its snapshot and protects newly fetched entries',async()=>{
 const m=await setup(),cache=store(m,'test',14,1);let cleared=false,time=0;
 for(let i=0;i<3;i++)caches.seed('test','/'+i,envelope({value:'old'},{StoredAt:i}));
 await m.SweepExpireStores(async()=>{
  if(cleared)return;cleared=true;await m.ClearCacheEntries(['test']);await cache.SetItem('fresh',{value:'fresh'},cache.GetGeneration());
 },()=>false,()=>time+=5);
 assert.equal(caches.stores.get('test').size,1);assert.deepEqual(await cache.GetItem('fresh'),{value:'fresh'});
});

test('eviction re-reads timestamps and preserves an entry replaced after scanning',async()=>{
 const m=await setup(),cache=store(m,'test',14,1);let scanned=0,replaced=false;
 caches.seed('test','/old',envelope({value:'old'},{StoredAt:1}));caches.seed('test','/new',envelope({value:'new'},{StoredAt:2}));
 const open=caches.open.bind(caches);caches.open=async name=>{const c=await open(name),match=c.match;c.match=async key=>{scanned++;return match(key)};return c};
 await m.SweepExpireStores(async()=>{
  if(scanned===2&&!replaced){replaced=true;await cache.SetItem('old',{value:'replacement'});}
 },()=>false,()=>scanned*5);
 assert.equal(replaced,true);assert.equal(caches.item('test','/old').Content.value,'replacement');assert.equal(caches.item('test','/new').Content.value,'new');
});

test('cancelling while a sweep read is pending skips validation and deletion',async()=>{
 const m=await setup();let cancelled=false,validated=0,release,begin;const began=new Promise(resolve=>{begin=resolve});
 m.GetExpireStore('test',1,{Duration:14,Unit:'Days'},undefined,()=>{validated++;return true});caches.seed('test','/x',envelope(false,{ExpiresAt:0}));
 const open=caches.open.bind(caches);caches.open=async name=>{const c=await open(name),match=c.match;c.match=async key=>{begin();await new Promise(resolve=>{release=resolve});return match(key)};return c};
 const sweep=m.SweepExpireStores(async()=>{},()=>cancelled);await began;cancelled=true;release();await sweep;
 assert.equal(validated,0);assert.equal(caches.stores.get('test').size,1);assert.equal(caches.operations.filter(([op])=>op==='delete').length,0);
});
