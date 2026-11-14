import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as sass from 'sass';
import {buildBackgroundFixture} from './background-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';

const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('real WebGL toggles/remounts dispose contexts; static/frozen sleep and context restore redraws', {skip:!chrome},async()=>{
  const code=await buildBackgroundFixture(true);
  const css=['Extension/Source/Stylings/main.scss','Extension/Source/LyricViews/Card/style.scss'].map(file=>sass.compile(file).css).join('\n');
  function setup(){
    const check=(ok,message)=>{if(!ok)throw Error(message)},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const {BackgroundController,PresentationSettings,THREE,artwork,setPlaying}=backgroundModule;
    const set=value=>PresentationSettings.saveBackground('NowPlaying',{...PresentationSettings.getBackground('NowPlaying'),...value});
    const surface=document.createElement('div');surface.id='BeautifulLyrics-CardView';surface.style.width='420px';surface.style.height='300px';surface.innerHTML='<div class="Header">Lyrics</div><div class="LyricsContent">source</div>';
    const sidebar=document.createElement('aside');sidebar.className='theme-sidebar os-host';sidebar.style.background='rgb(1, 2, 3)';
    const scrollbar=document.createElement('div');scrollbar.className='os-scrollbar';sidebar.append(surface,scrollbar);document.body.append(sidebar);
    const original=surface.outerHTML,sidebarClass=sidebar.className;
    // Three r164 defines render/dispose per instance, so observe the real WebGL
    // calls instead: every draw call and every context handed to a canvas.
    let draws=0;const contexts=[];
    const live={get size(){return contexts.filter(context=>!context.isContextLost()).length}};
    const oldGetContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...rest){const context=oldGetContext.call(this,type,...rest);if(context&&/webgl/.test(type)&&!contexts.includes(context))contexts.push(context);return context};
    for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype])for(const name of ['drawElements','drawArrays']){const old=proto[name];proto[name]=function(...args){draws++;return old.apply(this,args)}}
    const image=new OffscreenCanvas(32,32);image.getContext('2d').fillRect(0,0,32,32);artwork.image=image;
    window.backgroundFixture={async run(){
      let controller=new BackgroundController(surface,{view:'NowPlaying',surface:'Card'});
      check(surface.outerHTML===original&&artwork.consumers===0,'Off keeps exact DOM');
      set({mode:'static'});await frame();check(surface.querySelectorAll('canvas').length===1&&live.size===1,'real renderer mounted');
      const gl=contexts.at(-1);check(gl&&!gl.isContextLost()&&draws>0,'real WebGL context draws');
      let count=draws;await wait(150);check(draws===count,'static draws no loop');
      const canvas=surface.querySelector('canvas');check(getComputedStyle(canvas).zIndex==='-1'&&getComputedStyle(canvas).borderRadius==='8px','card layering/radius');
      check(getComputedStyle(canvas).filter==='saturate(2) brightness(0.7)','card Classic filter');
      check(getComputedStyle(scrollbar).paddingTop==='0px','card does not style ancestor scrollbars');
      set({brightness:150});await frame();check(draws===count,'brightness is CSS only');check(getComputedStyle(canvas).filter==='saturate(2) brightness(1.05)','CSS brightness multiplier');
      const extension=gl.getExtension('WEBGL_lose_context');check(extension,'context loss extension available');
      const lost=new Promise(resolve=>canvas.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;await wait(100);
      count=draws;await wait(80);check(draws===count,'lost context stops drawing');
      const restored=new Promise(resolve=>canvas.addEventListener('webglcontextrestored',resolve,{once:true}));extension.restoreContext();await Promise.race([restored,wait(4000).then(()=>{throw Error('context restore timeout')})]);await frame();check(draws>count,'restored static context redraws');
      set({mode:'animated',paused:'freeze'});setPlaying(false);await frame();count=draws;await wait(150);check(draws===count,'paused Freeze has no draws');
      setPlaying(true);await wait(150);check(draws>count,'play resumes');setPlaying(false);count=draws;await wait(100);check(draws===count,'pause stops immediately');
      for(let i=0;i<15;i++){
        set({mode:'off'});await frame();check(live.size===0&&artwork.consumers===0&&surface.outerHTML===original,'Off releases exact card DOM '+i);
        set({mode:'static'});await frame();check(live.size===1&&surface.querySelectorAll('canvas').length===1,'one live context '+i);
        controller.Destroy();await frame();check(live.size===0&&artwork.consumers===0&&surface.outerHTML===original,'remount cleanup '+i);
        controller=new BackgroundController(surface,{view:'NowPlaying',surface:'Card'});await frame();
      }
      controller.Destroy();await frame();check(live.size===0&&artwork.consumers===0,'all contexts disposed');
      check(contexts.every(context=>context.isContextLost()),'all disposed contexts explicitly lost');
      check(sidebar.className===sidebarClass&&getComputedStyle(sidebar).backgroundColor==='rgb(1, 2, 3)','theme sidebar untouched');
      return {created:contexts.length,released:contexts.filter(context=>context.isContextLost()).length};
    }};
    jelTestComplete('BACKGROUND_READY');
  }
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-background-')));
  try{
    const file=path.join(directory,'fixture.html');await writeFile(file,'<!doctype html><meta charset="utf-8"><body><style>'+css+'</style><script>'+(code+';('+setup.toString()+')();').replaceAll('</script','<\\/script')+'</script>');
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile'),async send=>{
      const result=await send('Runtime.evaluate',{expression:'new Promise((resolve,reject)=>{const ready=()=>globalThis.backgroundFixture?backgroundFixture.run().then(resolve,reject):setTimeout(ready,10);ready()})',awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      assert.ok(result.result.value.created>=30);assert.equal(result.result.value.created,result.result.value.released);
    }),'BACKGROUND_READY');
  }finally{
    assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-background-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3});
  }
});
