import {build} from 'esbuild';
import path from 'node:path';

export const playerStub = `
  import {Signal} from '@Universal/Modules/Signal.ts';
  const play=new Signal(),song=new Signal(),context=new Signal();
  export let IsPlaying=false;
  export const IsPlayingChanged=play.GetEvent(),SongChanged=song.GetEvent(),SongContextChanged=context.GetEvent();
  export const setPlaying=value=>{IsPlaying=value;play.Fire()};
  export const songChanged=()=>song.Fire(),contextChanged=()=>context.Fire();
`;
const threeStub = `
  export const stats={renderers:[],materials:[],textures:[],geometries:[],fail:false};
  export class Vector2 {set(x,y){this.x=x;this.y=y;return this}}
  export class OrthographicCamera {position={z:0}}
  export class PlaneGeometry {constructor(){stats.geometries.push(this)}dispose(){this.disposed=true}}
  export class Scene {add(mesh){this.mesh=mesh}}
  export class ShaderMaterial {constructor(options){Object.assign(this,options);stats.materials.push(this)}dispose(){this.disposed=true}}
  export class Mesh {constructor(geometry,material){this.geometry=geometry;this.material=material}}
  export class WebGLRenderer {
    constructor(){if(stats.fail)throw Error('fixture failure');this.domElement=document.createElement('canvas');this.draws=0;stats.renderers.push(this)}
    setPixelRatio(ratio){this.ratio=ratio}setSize(width,height){this.size=[width,height]}
    render(){this.draws++}dispose(){this.disposed=true}forceContextLoss(){this.lost=true}
  }
  export class CanvasTexture {constructor(image){this.image=image;stats.textures.push(this)}dispose(){this.disposed=true}}
  export const NearestFilter=1;
`;

export async function buildBackgroundFixture(realThree=false) {
  return (await build({stdin:{contents:`
    export {default as BackgroundController} from './Extension/Source/Modules/Background/BackgroundController.ts';
    export {PresentationSettings} from './Extension/Source/PresentationSettings.ts';
    export * from '@Spices/Spicetify/Services/Player/mod.ts';
    export {artwork} from './Extension/Source/Modules/Background/BackgroundArtwork.ts';
    export * as THREE from 'jsr:@3d/three';`,resolveDir:process.cwd()},bundle:true,write:false,format:realThree?'iife':'esm',globalName:realThree?'backgroundModule':undefined,
    plugins:[{name:'background-host',setup(b){
      b.onResolve({filter:/^@Universal\//},a=>({path:path.resolve('Universal',a.path.slice('@Universal/'.length))}));
      b.onResolve({filter:/Player\/mod\.ts$/},()=>({path:'player',namespace:'fixture'}));
      b.onResolve({filter:/BackgroundArtwork\.ts$/},()=>({path:'artwork',namespace:'fixture'}));
      b.onResolve({filter:/^jsr:/},()=>realThree?{path:path.resolve('node_modules/three/build/three.module.js')}:{path:'three',namespace:'fixture'});
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='player'?playerStub:a.path==='three'?threeStub:`
        import {Signal} from '@Universal/Modules/Signal.ts';
        const changed=new Signal();
        export const artwork={consumers:0,acquires:0,image:undefined,change(){changed.Fire()}};
        export function Acquire(){artwork.consumers++;artwork.acquires++;let released=false;return {
          Current:()=>artwork.image,Changed:changed.GetEvent(),Release(){if(!released){released=true;artwork.consumers--}}
        }};
      `}));
    }}]})).outputFiles[0].text;
}
