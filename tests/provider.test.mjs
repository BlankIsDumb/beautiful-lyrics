import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the real provider with a fake transport; no API quota is consumed.
const compiled = await build({entryPoints:['Extension/Spices/Spicetify/Services/Player/Musixmatch.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
  name:'fake-session',setup(b){b.onResolve({filter:/Session\.ts$/},()=>({path:'session',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const SpotifyInternalFetch={get:(...args)=>globalThis.testTransport(...args)};'}));}
}]});
let instance=0;
const track={uri:'spotify:track:example',name:'Example',artists:[{name:'Artist'}],album:{name:'Album'}};
const response=body=>({message:{header:{status_code:200},body}});
const richBody={macro_calls:{'matcher.track.get':response({track:{track_spotify_id:'example'}}),'track.richsync.get':response({richsync:{richsync_body:JSON.stringify([{ts:0,te:2,l:[{c:'one',o:0},{c:'two',o:1}]}])}})}};
async function setup(transport){
  const store=new Map([['BeautifulLyricsLocal/MusixmatchToken','test-token']]);
  globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.testTransport=transport;
  return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text+`\n// ${instance++}`).toString('base64'));
}
test('coalesces concurrent lookups and uses only the provider token',async()=>{
  let calls=0;
  const provider=await setup(async(url,_,headers)=>{calls++;assert.equal(new URL(url).searchParams.get('usertoken'),'test-token');assert.equal(headers.Authorization,undefined);return response(richBody);});
  const a=provider.FetchMusixmatchLyrics(track,3,()=>true);
  const b=provider.FetchMusixmatchLyrics(track,3,()=>true);
  assert.equal(a,b);assert.equal((await a).Type,'Syllable');assert.equal(calls,1);
});
test('quota denial starts a persistent cooldown and does not fall back to line sync',async()=>{
  let calls=0;
  const provider=await setup(async()=>{calls++;return {message:{header:{status_code:429}}};});
  await assert.rejects(provider.FetchMusixmatchLyrics(track,3,()=>true),/429/);
  await assert.rejects(provider.FetchMusixmatchLyrics(track,3,()=>true),/cooling down/);
  assert.equal(calls,1);
});
test('richsync paywall/access denial is surfaced rather than hidden',async()=>{
  const body=structuredClone(richBody);body.macro_calls['track.richsync.get']={message:{header:{status_code:402}}};
  const provider=await setup(async()=>response(body));
  await assert.rejects(provider.FetchMusixmatchLyrics(track,3,()=>true),/402/);
});
test('stale songs never call the provider',async()=>{
  const provider=await setup(async()=>{throw new Error('must not fetch');});
  await assert.rejects(provider.FetchMusixmatchLyrics(track,3,()=>false),/Track changed/);
});
test('wrong recording cannot populate the cache',async()=>{
  const body=structuredClone(richBody);body.macro_calls['matcher.track.get'].message.body.track.track_spotify_id='other';
  const provider=await setup(async()=>response(body));
  await assert.rejects(provider.FetchMusixmatchLyrics(track,3,()=>true),/different recording/);
});
test('same recording on a re-release is accepted by ISRC',async()=>{
  const body=structuredClone(richBody);Object.assign(body.macro_calls['matcher.track.get'].message.body.track,{track_spotify_id:'reissue',track_isrc:'TEST00000001'});
  const provider=await setup(async()=>response(body));
  assert.equal((await provider.FetchMusixmatchLyrics(track,3,()=>true,'TEST00000001')).Type,'Syllable');
});
test('preserves static lyrics when neither richsync nor subtitles exist',async()=>{
  const body=structuredClone(richBody);delete body.macro_calls['track.richsync.get'];
  body.macro_calls['track.lyrics.get']=response({lyrics:{lyrics_body:'One\n\nTwo'}});
  const provider=await setup(async()=>response(body));
  assert.deepEqual(await provider.FetchMusixmatchLyrics(track,3,()=>true),{Type:'Static',Lines:[{Text:'One'},{Text:'Two'}]});
});


test('a track changed during provider spacing never dispatches its waiting request', async () => {
  let calls=0,current=true;
  const provider=await setup(async()=>{calls++;return response(richBody);});
  await provider.FetchMusixmatchLyrics(track,3,()=>true);
  const waiting=provider.FetchMusixmatchLyrics(track,3,()=>current);
  setTimeout(()=>{current=false;},20);
  await assert.rejects(waiting,/Track changed/);
  assert.equal(calls,1);
});
