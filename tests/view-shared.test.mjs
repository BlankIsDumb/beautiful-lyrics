import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

test('importing Shared allocates no artwork or GlobalMaid subscriptions', async () => {
  const built = await build({ stdin: {
    contents: `export * from './Extension/Source/LyricViews/Shared.ts'; export {GlobalMaid} from '@Spices/Spicetify/Services/Session.ts';`,
    resolveDir: process.cwd(),
  }, bundle: true, write: false, format: 'esm', plugins: [{ name: 'view-environment', setup(b) {
    b.onResolve({ filter: /^@Universal\/Modules\/Signal\.ts$/ }, () => ({ path: path.resolve('Universal/Modules/Signal.ts') }));
    b.onResolve({ filter: /^(npm:|jsr:|@Spices\/)|Scheduler\.ts$|Shaders\.ts$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents:
      a.path.includes('seedrandom') ? 'export default ()=>()=>0.5;'
      : a.path.startsWith('jsr:') ? `export class OrthographicCamera {position={z:0}}; export class PlaneGeometry {}
          export class Scene {}; export class ShaderMaterial {}; export class Mesh {}; export class WebGLRenderer {};
          export class CanvasTexture {}; export const NearestFilter=0;`
      : a.path.includes('Session.ts') ? `export const GlobalMaid={items:[],Give(item){this.items.push(item);return item;}};`
      : a.path.includes('Cache.ts') ? `export const GetInstantStore=(_name,_version,Items)=>({Items,SaveChanges(){}});`
      : a.path.includes('Player/mod.ts') ? `import {Signal} from '@Universal/Modules/Signal.ts';
          export const Song=undefined,SongContext=undefined,SongChanged=new Signal().GetEvent(),SongContextChanged=new Signal().GetEvent();`
      : a.path.includes('Scheduler.ts') ? 'export const OnPreRender=()=>{};'
      : 'export const GetShaderUniforms=()=>({}),VertexShader="",FragmentShader="";',
    }));
  } }] });
  const previous = globalThis.Image;
  let images = 0;
  globalThis.Image = class { constructor() { images++; } async decode() { throw new Error('fixture image unavailable'); } };
  try {
    // Execute the real module: importing view helpers alone must stay idle.
    const module = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
    assert.equal(module.Store.Items.CardLyricsVisible, false);
    assert.equal(module.GlobalMaid.items.length, 0);
    assert.equal(images, 0);
  } finally {
    globalThis.Image = previous;
  }
});
