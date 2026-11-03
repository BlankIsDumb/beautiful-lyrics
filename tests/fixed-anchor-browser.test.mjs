import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as sass from 'sass';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('fixed anchor actual clock/sources: three surfaces, Word/Line/forced Line, context, edge anchors and silent navigation', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,true,false,true,true);
 const surfaces=['Extension/Source/LyricViews/Card/style.scss','Extension/Source/LyricViews/Page/style.scss'].map(file=>sass.compile(file).css).join('\n');
 function setup(){
  const {LyricsRenderer,PresentationSettings,ClassicLayout,ClassicRendering,ApplyTextPreset}=fixtureModule;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check=(value,message)=>{if(!value)throw Error(message)};
  window.anchorFixture={async run(kind,precision,context,anchor,count=20,hostHeight=800){
   const host=document.createElement('div');host.style.cssText='width:'+(kind==='Card'?420:900)+'px;height:'+hostHeight+'px;position:relative;container-type:size';document.body.append(host);
   if(kind==='Card')host.innerHTML='<div id="BeautifulLyrics-CardView"><div class="Header" data-encore-id="type"><div class="Title">Lyrics</div><div class="Controls"><button class="ViewControl">R</button><button class="ViewControl">P</button><button class="ViewControl">X</button></div></div><div class="LyricsContent"><div class="ContentContainer"></div></div></div>';
   else{host.classList.add('Root__main-view');host.innerHTML='<div class="BeautifulLyricsPage '+kind+'"><div class="Content"></div></div>';}
   const parent=host.querySelector(kind==='Card'?'.ContentContainer':'.Content'),view=kind==='Card'?'NowPlaying':'FullLyrics';
   const reservation=document.createElement('div');reservation.style.cssText='position:absolute;left:0;top:0;width:400px;height:800px';host.append(reservation);
   PresentationSettings.saveHorizontalSpacing(kind,0);
   PresentationSettings.saveLayout(view,{...ClassicLayout,transition:'instant',anchor,before:context,after:context});
   const effects=ApplyTextPreset({...ClassicRendering},'minimal');
   PresentationSettings.saveRendering(view,precision==='Line'?'Line':'Word',{...effects,detail:precision==='ForcedLine'?'line':'auto'});
   PresentationSettings.saveCues(view,{...PresentationSettings.getCues(view),threshold:0});
   let time=0;const consumers=new Set();const clock={now:()=>time,duration:()=>200,seek(){throw Error('No real player')},subscribe:fn=>{consumers.add(fn);return()=>consumers.delete(fn)}};
   const syllables=i=>[{Text:'Source ',StartTime:1+i*4,EndTime:2+i*4,IsPartOfWord:false},{Text:'group '+i,StartTime:2+i*4,EndTime:3+i*4,IsPartOfWord:false}];
   const source={Type:precision==='Line'?'Line':'Syllable',NaturalAlignment:'Left',StartTime:1,EndTime:count*4,Source:{HasWordSync:precision!=='Line'},Content:Array.from({length:count},(_,i)=>precision==='Line'?{Type:'Vocal',Text:'Source group '+i,StartTime:1+i*4,EndTime:3+i*4}:{Type:'Vocal',Lead:{StartTime:1+i*4,EndTime:3+i*4,Syllables:syllables(i)}})};
   const renderer=new LyricsRenderer(parent,source,false,view,clock,undefined,{surface:kind,reservation});
   try{
    await frame();await frame();const root=parent.querySelector('.Lyrics'),scroll=parent.querySelector('.simplebar-content-wrapper'),groups=[...root.querySelectorAll('.VocalsGroup')].filter(g=>!g.querySelector('.Interlude'));
    check(scroll.clientHeight>0&&scroll.clientHeight<=800,'bounded real scrollport');if(count>1)check(scroll.scrollHeight>scroll.clientHeight,'real scroll range');
    check(root.dataset.effectivePrecision===(precision==='Word'?'word':'line'),'genuine source precision '+precision);
    if(kind==='Card') {
     const clip=host.querySelector('.LyricsContent').getBoundingClientRect(),port=scroll.getBoundingClientRect();
     check(port.top>=clip.top+16-.1&&port.bottom<=clip.bottom-16+.1,'Card scrollport fits actual header/padding/outer clip');
     const spaces=[...parent.querySelectorAll('.JEL-FollowSpace')].map(n=>n.getBoundingClientRect().height);
     check(spaces.length===2&&spaces[0]<=24&&spaces[1]<=64,'Card never reserves anchor-sized song-edge space');
    }
    const H=scroll.clientHeight,top=Math.min(24,H/2),bottom=Math.min(64,Math.max(0,H-top-1)),A=top+(H-top-bottom)*anchor/100;
    const expectedCenter=(r,v)=>{const desired=Math.max(top+r.height/2,Math.min(H-bottom-r.height/2,A));if(kind!=='Card')return desired;const contentCenter=(r.top+r.bottom)/2-v.top+scroll.scrollTop;return contentCenter-Math.max(0,Math.min(scroll.scrollHeight-H,contentCenter-desired))};
    const tick=async(t,seek=false)=>{time=t;for(const fn of consumers)fn(1/60,seek||undefined);await frame()};
    const samples=[];
    for(const index of [...new Set([0,1,2,3,count-1])].filter(i=>i<count)){
     await tick(1.5+index*4);
     const target=groups[index].querySelector('.Vocals'),r=target.getBoundingClientRect(),v=scroll.getBoundingClientRect();
     if(kind==='Card' && r.height<=H-top-bottom) {
      const clip=host.querySelector('.LyricsContent').getBoundingClientRect();
      check(r.top>=clip.top+24-1.5&&r.bottom<=clip.bottom-64+1.5,'Card source stays inside actual outer readable mask region');
      if(index===0)check(scroll.scrollTop<=1.5&&Math.abs(r.top-v.top-top)<1.5,'Card first source starts at readable top without anchor gap '+JSON.stringify({precision,anchor,count,index,scroll:scroll.scrollTop,top:r.top-v.top,safe:top,spacers:[...parent.querySelectorAll('.JEL-FollowSpace')].map(n=>n.getBoundingClientRect().height)}));
      if(index===count-1&&count>1)check(Math.abs(scroll.scrollTop-(scroll.scrollHeight-H))<1.5&&Math.abs(r.bottom-v.top-(H-bottom))<1.5,'Card last source ends at natural readable bottom');
      if(count===1)check(scroll.scrollTop===0&&Math.abs(r.top-v.top-top)<1.5,'short Card stays top aligned');
     }
     const expected=expectedCenter(r,v),center=(r.top+r.bottom)/2-v.top;
     check(Math.abs(center-expected)<1.5,JSON.stringify({kind,precision,context,anchor,index,center,expected,scroll:scroll.scrollTop,max:scroll.scrollHeight-H}));samples.push({index,center,expected,scroll:scroll.scrollTop});
     const held=scroll.scrollTop;await tick(3.5+index*4);check(Math.abs(scroll.scrollTop-held)<.1,'ordinary silence holds');
    }
    const last=scroll.scrollTop;await tick(count*4+10);check(Math.abs(scroll.scrollTop-last)<.1,'ending holds final position');
    await tick(7.5,true);const r=groups[Math.min(count-1,1)].querySelector('.Vocals').getBoundingClientRect(),v=scroll.getBoundingClientRect();
    const expected=expectedCenter(r,v);check(Math.abs((r.top+r.bottom)/2-v.top-expected)<1.5,'external silent navigation uses preceding source');
    await tick(0,true);const first=groups[0].querySelector('.Vocals').getBoundingClientRect();check(Math.abs((first.top+first.bottom)/2-v.top-expectedCenter(first,v))<1.5,'before-first navigation');
    return samples;
   }finally{renderer.Destroy();check(consumers.size===0,'clock cleanup');check(!host.querySelector('.JEL-FollowSpace'),'owned spacers cleanup');host.remove();}
  },async special(){
   const host=document.createElement('div');host.style.cssText='width:420px;height:340px;position:relative;container-type:size;display:none';host.className='special';document.body.append(host);
   const view='NowPlaying';PresentationSettings.saveLayout(view,{...ClassicLayout,transition:'instant'});PresentationSettings.saveHorizontalSpacing('Card',0);PresentationSettings.saveCues(view,{threshold:1,motion:false});
   const consumers=new Set();let time=2;const clock={now:()=>time,duration:()=>200,seek(){},subscribe:fn=>{consumers.add(fn);return()=>consumers.delete(fn)}};
   const source={Type:'Line',NaturalAlignment:'Left',StartTime:10,EndTime:102,Content:[10,20,100].map((start,index)=>({Type:'Vocal',Text:'Silent gap control '+index,StartTime:start,EndTime:start+2}))};
   const renderer=new LyricsRenderer(host,source,false,view,clock,undefined,{surface:'Card'});
   try{
    await frame();const scroll=host.querySelector('.simplebar-content-wrapper');check(scroll.scrollTop===0,'zero geometry does not fabricate target');host.style.display='block';await frame();await frame();
    const tick=async(t,seek=false)=>{time=t;for(const fn of consumers)fn(1/60,seek||undefined);await frame();await frame()};
    const checkTarget=element=>{const H=scroll.clientHeight,st=Math.min(24,H/2),sb=Math.min(64,Math.max(0,H-st-1)),A=st+(H-st-sb)*.45,r=element.getBoundingClientRect(),v=scroll.getBoundingClientRect();const center=(r.top+r.bottom)/2-v.top,contentCenter=center+scroll.scrollTop,expected=contentCenter-Math.max(0,Math.min(scroll.scrollHeight-H,contentCenter-A));check(Math.abs(center-expected)<1.5,'cue/source respects natural Card range '+JSON.stringify({r:r.toJSON(),v:v.toJSON(),A}));};
    await tick(2);checkTarget(host.querySelector('.Interlude.Active').parentElement);
    await tick(10.5);checkTarget([...host.querySelectorAll('.VocalsGroup')].find(g=>g.querySelector('.Vocals')));
    await tick(15);checkTarget(host.querySelector('.Interlude.Active').parentElement);
    await tick(100.5);const last=scroll.scrollTop;await tick(110);check(scroll.scrollTop<=last+.1&&scroll.scrollTop<=scroll.scrollHeight-scroll.clientHeight,'Card cue disappearance permits only natural-range clamp');
   }finally{renderer.Destroy();host.remove();}
   // One genuinely oversized source voice has two timed boundaries. Neither
   // the boundary nor subsequent progress can pan through the unchanged voice.
   const tallHost=document.createElement('div');tallHost.className='special';tallHost.style.cssText='width:420px;height:200px;container-type:size';document.body.append(tallHost);
   time=1.2;PresentationSettings.saveCues(view,{threshold:0,motion:false});
   const tall={Type:'Syllable',Source:{HasWordSync:true},NaturalAlignment:'Left',StartTime:1,EndTime:5,Content:[{Type:'Vocal',Lead:{StartTime:1,EndTime:5,Syllables:[{Text:'a very long source phrase '.repeat(18),StartTime:1,EndTime:3,IsPartOfWord:false},{Text:'its final phrase',StartTime:3,EndTime:5,IsPartOfWord:false}]}}]};
   const tallRenderer=new LyricsRenderer(tallHost,tall,false,view,clock,undefined,{surface:'Card'});
   try{await frame();await frame();const scroll=tallHost.querySelector('.simplebar-content-wrapper'),voice=tallHost.querySelector('.Vocals');const initial=scroll.scrollTop,r=voice.getBoundingClientRect(),v=scroll.getBoundingClientRect();check(r.height>scroll.clientHeight-88,'actually oversized');check(Math.abs(r.top-v.top-24)<1.5,'oversized voice top at readable top');time=3.2;for(const fn of consumers)fn(1/60);await frame();check(Math.abs(scroll.scrollTop-initial)<.1,'unchanged tall voice does not pan at segment boundary');}finally{tallRenderer.Destroy();tallHost.remove();}
   return true;
  }};jelTestComplete('ANCHOR_READY');
 }
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-anchor-')));
 try{
  const file=path.join(directory,'fixture.html');await writeFile(file,'<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}.special .LyricsScrollContainer{width:100%;height:100%}.special .Lyrics{--minimum-lyrics-size:32px;--maximum-lyrics-size:32px}'+css+surfaces+'</style><script>'+(code+';('+setup.toString()+')();').replaceAll('</script','<\\/script')+'</script>');
  assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile'),async send=>{
   for(const kind of ['Card','Contained','Fullscreen'])for(const precision of ['Word','Line','ForcedLine'])for(const context of [null,1,0])for(const anchor of [0,45,50,73.25,100]){
    const response=await send('Runtime.evaluate',{expression:`anchorFixture.run(${JSON.stringify(kind)},${JSON.stringify(precision)},${context},${anchor})`,awaitPromise:true,returnByValue:true});
    if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
   }
   for(const count of [1,20]) {
    const response=await send('Runtime.evaluate',{expression:`anchorFixture.run('Card','Word',1,45,${count},1680)`,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
   }
   for(const deviceScaleFactor of [.9509072303771973,1.25]) {
    await send('Emulation.setDeviceMetricsOverride',{width:1100,height:1200,deviceScaleFactor,mobile:false});
    for(const hostHeight of [480,1277,1680])for(const count of [1,20]) {
     const response=await send('Runtime.evaluate',{expression:`anchorFixture.run('Card','Word',1,45,${count},${hostHeight})`,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
    }
   }
   await send('Emulation.clearDeviceMetricsOverride');
   const special=await send('Runtime.evaluate',{expression:'anchorFixture.special()',awaitPromise:true,returnByValue:true});if(special.exceptionDetails)throw Error(special.exceptionDetails.exception?.description||special.exceptionDetails.text);
   for(const kind of ['Card','Contained','Fullscreen']){
    const response=await send('Runtime.evaluate',{expression:`anchorFixture.run(${JSON.stringify(kind)},'Word',0,45,1)`,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
   }
  }),'ANCHOR_READY');
 }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-anchor-'));await rm(directory,{recursive:true,force:true,maxRetries:3});}
});
