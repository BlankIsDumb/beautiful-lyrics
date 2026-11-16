import { build } from 'esbuild';

// In-memory Cache API substitute. It preserves response cloning and insertion
// order, and exposes faults without using the user's Spotify cache or quotas.
export function fakeCaches() {
  const stores = new Map(), operations = [], faults = new Set();
  const check = name => { if (faults.has(name)) throw Error('fixture ' + name); };
  const keyOf = key => typeof key === 'string' ? new URL(key, 'https://fixture.test').href : key.url;
  const open = async name => {
    operations.push(['open', name]); check('open');
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async match(key) { operations.push(['match', name, keyOf(key)]); check('match'); const text = entries.get(keyOf(key)); return text === undefined ? undefined : new Response(text); },
      async put(key, response) { check('put'); entries.set(keyOf(key), await response.text()); operations.push(['put', name, keyOf(key)]); },
      async keys() { operations.push(['keys', name]); check('keys'); return [...entries.keys()].map(key => new Request(key)); },
      async delete(key) { check('delete'); operations.push(['delete', name, keyOf(key)]); return entries.delete(keyOf(key)); },
    };
  };
  return { stores, operations, faults, open,
    async keys() { operations.push(['stores']); check('stores'); return [...stores.keys()]; },
    async delete(name) { operations.push(['drop', name]); check('drop'); return stores.delete(name); },
    seed(name, key, value) { if (!stores.has(name)) stores.set(name, new Map()); stores.get(name).set(keyOf(key), typeof value === 'string' ? value : JSON.stringify(value)); },
    item(name, key) { const value = stores.get(name)?.get(keyOf(key)); return value === undefined ? undefined : JSON.parse(value); },
  };
}
let serial = 0;
export async function compileFixture(contents) {
  const result = await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', plugins: [{
    name: 'cache-host', setup(b) {
      b.onResolve({ filter: /Session\.ts$/ }, () => ({ path: 'session', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const IsDevelopment=false; export const Spotify={CosmosAsync:{get:(...a)=>globalThis.spotifyRequest(...a)}}; export const SpotifyInternalFetch={get:(...a)=>globalThis.musixmatchRequest(...a)};' }));
    },
  }] });
  return () => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n//' + serial++).toString('base64'));
}
export const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
export const storage = () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  return values;
};
