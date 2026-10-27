import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { wrapBundle } from '../scripts/bundle-wrapper.mjs';
import { build } from 'esbuild';

function runtime() {
  const styles = [];
  const errors = [];
  const context = vm.createContext({
    Symbol, console: { error: (...args) => errors.push(args) },
    document: {
      createElement: () => ({ remove() { const index = styles.indexOf(this); if (index >= 0) styles.splice(index, 1); } }),
      head: { append: style => styles.push(style) },
    },
    starts: 0,
  });
  return { context, styles, errors, run: code => vm.runInContext(code, context) };
}
const source = `globalThis.starts++;
await Promise.resolve();
globalThis.active = {dispose() { globalThis[Symbol.for('JustEnoughLyrics/Runtime')].release(); }};`;

for (const order of [['canonical', 'legacy'], ['legacy', 'canonical']]) {
  test(`artifact aliases initialize once when loaded ${order.join(' then ')}`, async () => {
    const r = runtime();
    // Independent scripts, as with browser module URLs. The second must skip
    // even while the first bundle is awaiting its dynamic module initialization.
    const first = r.run(wrapBundle(source, order[0]));
    const second = r.run(wrapBundle(source, order[1]));
    await Promise.all([first, second]);
    assert.equal(r.context.starts, 1);
    assert.equal(r.styles.length, 1);
    assert.equal(r.styles[0].textContent, order[0]);
    r.context.active.dispose();
    assert.equal(r.styles.length, 0);
    await r.run(wrapBundle(source, 'reload'));
    assert.equal(r.context.starts, 2);
    assert.equal(r.styles.length, 1);
  });
}

test('failed startup releases style/ownership so a corrected artifact can start', async () => {
  const r = runtime();
  await assert.rejects(r.run(wrapBundle('throw new Error("fixture startup failure");', 'css')), /fixture startup/);
  assert.equal(r.styles.length, 0);
  await r.run(wrapBundle(source, 'corrected'));
  assert.equal(r.context.starts, 1);
  assert.equal(r.styles.length, 1);
});

test('pre-guard local runtime is disposed once; foreign diagnostics are left alone', async () => {
  const r = runtime();
  let disposed = 0;
  r.context.BeautifulLyricsLocal = { version: '5.1.0-local.5', dispose() { disposed++; } };
  await r.run(wrapBundle(source, 'css'));
  assert.equal(disposed, 1);
  await r.run(wrapBundle(source, 'css'));
  assert.equal(disposed, 1);
  const foreign = runtime();
  foreign.context.BeautifulLyricsLocal = { version: 'foreign', dispose() { disposed++; } };
  await foreign.run(wrapBundle(source, 'css'));
  assert.equal(disposed, 1);
});

for (const asynchronous of [false, true]) {
test(`real entry cleans partial ${asynchronous ? 'async readiness' : 'module import'} failure before retry`, async () => {
  const built = await build({ entryPoints: ['Extension/Source/local.ts'], bundle: true, write: false, format: 'esm',
    plugins: [{ name: 'startup-fixture', setup(b) {
      b.onResolve({ filter: /Session\.ts$/ }, () => ({ path: 'session', namespace: 'fixture' }));
      b.onResolve({ filter: /main\.ts$/ }, () => ({ path: 'main', namespace: 'fixture' }));
      b.onResolve({ filter: /Player\/mod\.ts$/ }, () => ({ path: 'player', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'session'
        ? `export const GlobalMaid={Destroy(){globalThis.liveResources=0;}};`
        : a.path === 'main' ? (asynchronous
          ? `globalThis.liveResources=1; export const Ready=Promise.resolve().then(()=>{throw new Error('partial main failure');}); export default {};`
          : `globalThis.liveResources=1; throw new Error('partial main failure'); export default {};`)
        : `export const Song=undefined,HaveSongLyricsLoaded=false,SongLyrics=undefined,SongLyricsError=undefined;` }));
    } }],
  });
  const r = runtime();
  r.context.Spicetify = { Platform: {} };
  await assert.rejects(r.run(wrapBundle(built.outputFiles[0].text, 'css')), /partial main failure/);
  assert.equal(r.context.liveResources, 0);
  assert.equal(r.styles.length, 0);
  await r.run(wrapBundle(source, 'retry'));
  assert.equal(r.context.starts, 1);
});
}
