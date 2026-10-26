import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  stdin: {contents: "export * from './Extension/Spices/Spicetify/Services/Player/AdditionalProviders.ts'; export * from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts';",resolveDir:process.cwd()},
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  plugins: [
    {
      name: "cache",
      setup(b) {
        b.onResolve({ filter: /Cache\.ts$/ }, () => ({
          path: "cache",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents:
            "export const GetExpireStore=()=>({GetItem:async k=>globalThis.cache.get(k),SetItem:async(k,v)=>globalThis.cache.set(k,v)});",
        }));
      },
    },
  ],
});
let serial = 0;
async function setup() {
  const storage = new Map();
  globalThis.cache = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  return import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text + `\n//${serial++}`).toString(
        "base64",
      )
  );
}
const tokenKey = "BeautifulLyricsLocal/SpicyToken";
test('Spicy sends credentials only to the loopback relay',async()=>{
  const p=await setup();localStorage.setItem(tokenKey,'sl_pk_fixture');
  globalThis.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:8967/v1/lyrics/id');assert.equal(options.headers.Authorization,'Bearer sl_pk_fixture');return new Response('',{status:404});};
  assert.equal(await p.FetchSpicy('id',3,()=>true),undefined);
});
test("Spicy is silent with an empty token, including after an authenticated cache hit", async () => {
  const p = await setup();
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json({
      Status: 200,
      Body: {
        Type: "Line",
        source: "spotify",
        Content: [{ Type: "Vocal", Text: "hello", StartTime: 0, EndTime: 1 }],
      },
    });
  };
  assert.equal(await p.FetchSpicy("id", 3, () => true), undefined);
  assert.equal(calls, 0);
  localStorage.setItem(tokenKey, "test-token");
  assert.equal((await p.FetchSpicy("id", 3, () => true)).Type, "Line");
  await p.FetchSpicy("id", 3, () => true);
  assert.equal(calls, 1);
  localStorage.removeItem(tokenKey);
  assert.equal(await p.FetchSpicy("id", 3, () => true), undefined);
  assert.equal(calls, 1);
});
test("Spicy respects Retry-After without caching an error as missing lyrics", async () => {
  const p = await setup();
  localStorage.setItem(tokenKey, "test-token");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "120" } });
  };
  await assert.rejects(
    p.FetchSpicy("id", 3, () => true),
    /429/,
  );
  await assert.rejects(
    p.FetchSpicy("id", 3, () => true),
    /cooling down/,
  );
  assert.equal(calls, 1);
  assert.ok(
    Number(localStorage.getItem("BeautifulLyricsLocal/SpicyCooldown")) >
      Date.now() + 110000,
  );
});
test("LRCLIB queries local metadata, identifies this extension, and caches parsed lyrics", async () => {
  const p = await setup();
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    const q = new URL(url).searchParams;
    assert.equal(q.get("track_name"), "local title");
    assert.equal(q.get("artist_name"), "artist");
    assert.match(options.headers["Lrclib-Client"], /BeautifulLyricsLocal/);
    return Response.json({ syncedLyrics: "[00:01.00]hello\n[00:02.00]world" });
  };
  const track = {
    uri: "spotify:local:artist:album:title:3",
    name: "local title",
    artists: [{ name: "artist" }],
    album: { name: "album" },
  };
  assert.equal((await p.FetchLrclib(track, 3, () => true)).Content.length, 2);
  await p.FetchLrclib(track, 3, () => true);
  assert.equal(calls, 1);
});

test('settings preserve response cache until token changes or is removed',async()=>{
  const p=await setup();p.SetSpicyToken('one');let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({Status:200,Body:{Type:'Static',Lines:[{Text:'test'}]}})};
  await p.FetchSpicy('id',3,()=>true);
  const settings=p.GetBehaviorSettings();settings.fetchMode='required';settings.sidebarEnabled=false;settings.providers.Spotify=false;
  p.SaveProviderSettings('one',settings);
  await p.FetchSpicy('id',3,()=>true);assert.equal(calls,1);
  settings.providers.Spicy=false;p.SaveProviderSettings('one',settings);
  settings.providers.Spicy=true;p.SaveProviderSettings('one',settings);
  await p.FetchSpicy('id',3,()=>true);assert.equal(calls,1);
  p.SaveProviderSettings('two',settings);await p.FetchSpicy('id',3,()=>true);assert.equal(calls,2);
  p.SetSpicyToken('');assert.equal(await p.FetchSpicy('id',3,()=>true),undefined);
  p.SetSpicyToken('two');await p.FetchSpicy('id',3,()=>true);assert.equal(calls,3);
});
