import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBackgroundFixture} from './background-fixture.mjs';
const code=await buildBackgroundFixture();
let serial=0;

async function environment(run) {
  const keys=['document','Element','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','matchMedia','devicePixelRatio','localStorage'];
  const old=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  const frames=new Map(),observers=new Set(),queries=new Set();let next=0;
  class Element extends EventTarget {
    attrs=new Map();children=[];clientWidth=401;clientHeight=201;
    style={values:new Map(),setProperty(name,value){this.values.set(name,value)}};
    classList={add:(name)=>this.attrs.set('class',[...new Set([...(this.attrs.get('class')||'').split(' ').filter(Boolean),name])].join(' ')),
      remove:(name)=>this.attrs.set('class',(this.attrs.get('class')||'').split(' ').filter(x=>x!==name).join(' '))};
    hasAttribute(name){return this.attrs.has(name)}getAttribute(name){return this.attrs.get(name)??null}removeAttribute(name){this.attrs.delete(name)}
    prepend(child){child.parent=this;this.children.unshift(child)}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
  }
  globalThis.Element=Element;globalThis.document={createElement:()=>new Element()};
  globalThis.MutationObserver=class {constructor(){throw Error('background must never create a MutationObserver')}};
  globalThis.ResizeObserver=class {constructor(fn){this.fn=fn;observers.add(this)}observe(){}disconnect(){observers.delete(this)}};
  globalThis.requestAnimationFrame=fn=>{const id=++next;frames.set(id,fn);return id};globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.matchMedia=()=>{const query={addEventListener(_type,fn){this.fn=fn;queries.add(this)},removeEventListener(){queries.delete(this)}};return query};
  globalThis.devicePixelRatio=1.5;const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const flush=now=>{const current=[...frames];frames.clear();for(const [,fn]of current)fn(now)};
  try {
    const m=await import('data:text/javascript;base64,'+Buffer.from(code+`\n//${serial++}`).toString('base64'));
    const host=new Element();m.artwork.image={};
    const set=(value,view='NowPlaying')=>m.PresentationSettings.saveBackground(view,{...m.PresentationSettings.getBackground(view),...value});
    await run({...m,host,set,flush,frames,observers,queries});
  } finally {for(const key of keys){if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key]}}
}

test('Off allocates nothing, static draws coalesce, DPR and uniforms use effective ratio',()=>environment(m=>{
  const {BackgroundController,host,set,frames,artwork,THREE,flush,observers,queries}=m;
  const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});
  assert.equal(THREE.stats.renderers.length,0);assert.equal(frames.size,0);assert.equal(artwork.acquires,0);assert.equal(observers.size,0);assert.equal(queries.size,0);assert.equal(host.getAttribute('class'),null);
  set({mode:'static'});const renderer=THREE.stats.renderers[0],uniforms=THREE.stats.materials[0].uniforms;
  assert.equal(artwork.consumers,1);assert.equal(observers.size,1);assert.equal(queries.size,1);assert.equal(host.children.length,1);
  assert.equal(renderer.ratio,.75);assert.equal(uniforms.BackgroundCircleOrigin.value.x,Math.floor(401*.75)/2);
  assert.equal(uniforms.BackgroundCircleOrigin.value.y,Math.floor(201*.75)/2);
  flush(0);assert.equal(renderer.draws,1);assert.equal(frames.size,0);
  for(const observer of observers){observer.fn();observer.fn();}assert.equal(frames.size,0);
  host.clientWidth=403;for(const observer of observers){observer.fn();observer.fn();}assert.equal(frames.size,1);flush(16);assert.equal(frames.size,0);
  const draws=renderer.draws;set({brightness:125});assert.equal(frames.size,0);assert.equal(renderer.draws,draws);assert.equal(renderer.domElement.style.values.get('--jel-background-brightness'),'1.25');
  globalThis.devicePixelRatio=2;[...queries][0].fn();assert.equal(queries.size,1);assert.equal(renderer.ratio,1);flush(32);assert.equal(frames.size,0);
  set({resolution:'quarter'});assert.equal(renderer.ratio,.5);flush(48);
  set({mode:'off'});assert.equal(host.children.length,0);assert.equal(host.getAttribute('class'),null);assert.equal(artwork.consumers,0);assert.equal(observers.size,0);assert.equal(queries.size,0);assert.equal(frames.size,0);
  assert.ok(THREE.stats.textures.every(x=>x.disposed));assert.ok(THREE.stats.materials.every(x=>x.disposed));assert.ok(THREE.stats.geometries.every(x=>x.disposed));assert.ok(renderer.disposed&&renderer.lost);
  controller.Destroy();controller.Destroy();set({mode:'static'});assert.equal(THREE.stats.renderers.length,1);
}));

test('animated freeze sleeps, changes art once, resumes phase and respects other-view isolation',()=>environment(m=>{
  const {BackgroundController,host,set,flush,frames,THREE,artwork,setPlaying}=m;
  set({mode:'animated',fps:'30'});const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});
  flush(0);assert.equal(frames.size,0);const renderer=THREE.stats.renderers[0],uniforms=THREE.stats.materials[0].uniforms;
  artwork.change();flush(100);assert.equal(renderer.draws,2);assert.equal(frames.size,0);
  setPlaying(true);flush(1000);flush(1016);flush(1034);assert.equal(renderer.draws,4);assert.ok(uniforms.Time.value>0);
  setPlaying(false);assert.equal(frames.size,0);const phase=uniforms.Time.value;
  setPlaying(true);artwork.change();setPlaying(false);assert.equal(frames.size,1);flush(4000);assert.equal(frames.size,0);assert.equal(uniforms.Time.value,phase);
  set({mode:'off'},'FullLyrics');assert.equal(THREE.stats.renderers.length,1);assert.equal(artwork.consumers,1);
  setPlaying(true);flush(9000);assert.equal(uniforms.Time.value,phase);
  set({mode:'static'});flush(9034);assert.equal(frames.size,0);
  set({mode:'animated',paused:'animate'});setPlaying(false);flush(9100);assert.equal(frames.size,1);
  controller.Destroy();assert.equal(frames.size,0);assert.equal(artwork.consumers,0);
}));

test('continuous resize cannot advance the cap clock or delay normal 30 fps animation afterward',()=>environment(m=>{
  const {BackgroundController,host,set,flush,observers,THREE}=m;
  set({mode:'animated',paused:'animate',fps:'30'});
  const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});
  try {
    flush(0);const renderer=THREE.stats.renderers[0],frameDuration=1000/60;
    // Two seconds of 60 Hz invalidations must not build up future cap deadlines.
    for(let frame=1;frame<=120;frame++){
      host.clientWidth++;for(const observer of observers)observer.fn();flush(frame*frameDuration);
    }
    assert.equal(renderer.draws,121,'every resize receives its forced draw');
    const lastDirty=120*frameDuration,drawTimes=[];
    for(let frame=121;frame<=180;frame++){
      const before=renderer.draws,now=frame*frameDuration;flush(now);
      if(renderer.draws>before)drawTimes.push(now);
    }
    assert.ok(drawTimes.length>0&&drawTimes[0]-lastDirty<=34,'capped animation resumes within 34 ms of the final resize');
    assert.equal(drawTimes.length,30,'normal animation returns to 30 draws per second');
    for(let index=1;index<drawTimes.length;index++)assert.ok(Math.abs(drawTimes[index]-drawTimes[index-1]-1000/30)<.01,'steady 30 fps cadence after resize');
  } finally {controller.Destroy()}
}));

test('Contained and Fullscreen share a live profile and preserve their permanent layout class in Off',()=>environment(m=>{
  const {BackgroundController,host,set,flush,THREE,artwork}=m;
  const fullscreen=new globalThis.Element();
  for(const element of [host,fullscreen])element.classList.add('BeautifulLyricsBackground');
  const contained=new BackgroundController(host,{view:'FullLyrics',surface:'Contained'});
  const cinema=new BackgroundController(fullscreen,{view:'FullLyrics',surface:'Fullscreen'});flush(0);
  assert.equal(THREE.stats.renderers.length,2);assert.equal(artwork.consumers,2);
  set({resolution:'quarter',mode:'static'},'FullLyrics');flush(50);
  assert.ok(THREE.stats.renderers.every(renderer=>renderer.ratio===.375));
  set({mode:'off'},'FullLyrics');
  for(const element of [host,fullscreen]){assert.equal(element.children.length,0);assert.equal(element.getAttribute('class'),'BeautifulLyricsBackground')}
  assert.equal(artwork.consumers,0);contained.Destroy();cinema.Destroy();
}));

test('context loss stops work, restore reuploads and redraws static or animated',()=>environment(m=>{
  const {BackgroundController,host,set,flush,frames,THREE,artwork}=m;
  set({mode:'static'});const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});flush(0);
  const renderer=THREE.stats.renderers[0],canvas=renderer.domElement,texture=THREE.stats.textures[0];
  const loss=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(loss);assert.equal(loss.defaultPrevented,true);assert.equal(frames.size,0);
  artwork.change();assert.equal(frames.size,0);canvas.dispatchEvent(new Event('webglcontextrestored'));flush(100);assert.equal(renderer.draws,2);assert.equal(texture.disposed,true);assert.equal(frames.size,0);
  set({mode:'animated',paused:'animate'});flush(200);assert.equal(frames.size,1);
  canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert.equal(frames.size,0);
  canvas.dispatchEvent(new Event('webglcontextrestored'));flush(9000);assert.equal(frames.size,1);
  controller.Destroy();canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(frames.size,0);
}));

test('50 toggle cycles and remounts release every renderer, listener, texture and geometry',()=>environment(m=>{
  const {BackgroundController,host,set,flush,frames,THREE,artwork,observers,queries}=m;
  const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});
  for(let i=0;i<50;i++){
    set({mode:i%2?'static':'animated',paused:'animate'});flush(i*100);const canvas=host.children[0];set({mode:'off'});
    canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(frames.size,0);assert.equal(observers.size,0);assert.equal(queries.size,0);assert.equal(artwork.consumers,0);assert.equal(host.children.length,0);
    assert.equal(THREE.stats.renderers.filter(x=>!x.disposed||!x.lost).length,0);
  }
  controller.Destroy();
  for(let i=0;i<10;i++){set({mode:'static'});const mount=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});flush(10000+i);mount.Destroy()}
  assert.equal(THREE.stats.renderers.length,60);assert.ok(THREE.stats.textures.every(x=>x.disposed));assert.ok(THREE.stats.materials.every(x=>x.disposed));assert.ok(THREE.stats.geometries.every(x=>x.disposed));assert.equal(frames.size,0);assert.equal(queries.size,0);
}));

test('renderer creation failure logs once and stays off for that mount',()=>environment(m=>{
  const {BackgroundController,host,set,THREE,frames,artwork,observers}=m;THREE.stats.fail=true;
  const warn=console.warn;let warnings=0;console.warn=()=>warnings++;
  try{set({mode:'static'});const controller=new BackgroundController(host,{view:'NowPlaying',surface:'Card'});set({mode:'off'});set({mode:'animated'});assert.equal(warnings,1);assert.equal(frames.size,0);assert.equal(artwork.acquires,0);assert.equal(observers.size,0);assert.equal(host.getAttribute('class'),null);controller.Destroy()}finally{console.warn=warn}
}));
