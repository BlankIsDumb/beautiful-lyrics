import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('actual renderer/context/Simplebar obey Off, clicks, trusted smooth cancellation, delay edits and browsing anchors', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,true,false,true,true);
 const script=`(()=>{${code}
  const {LyricsRenderer,PresentationSettings,ClassicLayout,CreateRenderingCounters}=fixtureModule;
  const check=(ok,message)=>{if(!ok)throw Error(message)};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  let time=0,emitSeek=true,asyncSeek=false;const consumers=new Set(),seeks=[],writes=[];
  const clock={now:()=>time,duration:()=>200,seek:t=>{seeks.push(t);if(asyncSeek)return;time=t;if(emitSeek)for(const consume of consumers)consume(0,true)},subscribe:consume=>{consumers.add(consume);return()=>consumers.delete(consume)}};
  const tick=(t,seek=false)=>{time=t;for(const consume of consumers)consume(1/60,seek||undefined)};
  const set=values=>PresentationSettings.saveLayout('NowPlaying',{...PresentationSettings.getLayout('NowPlaying'),...values});
  set({...ClassicLayout,follow:false,before:1,after:1,transition:'instant',resume:'delay',resumeDelay:.2});
  const counters=CreateRenderingCounters(),host=document.querySelector('.ContentContainer');
  const source={Type:'Syllable',Source:{HasWordSync:true},NaturalAlignment:'Left',StartTime:1,EndTime:160,Content:Array.from({length:40},(_,index)=>({Type:'Vocal',Lead:{StartTime:index*4+1,EndTime:index*4+3,Syllables:[{Text:'Group '+index+' source words',StartTime:index*4+1,EndTime:index*4+3,IsPartOfWord:false}]}}))};
  const original=Element.prototype.scrollTo;Element.prototype.scrollTo=function(options,...args){if(this.classList?.contains('simplebar-content-wrapper'))writes.push({top:typeof options==='object'?options.top:options,behavior:options.behavior});return original.call(this,options,...args)};
  const renderer=new LyricsRenderer(host,source,false,'NowPlaying',clock,counters);
  const root=host.querySelector('.Lyrics'),scroll=host.querySelector('.simplebar-content-wrapper');let trustedWheel=false;host.addEventListener('wheel',event=>{trustedWheel=event.isTrusted},{passive:true});
  const groups=()=>[...root.querySelectorAll('.VocalsGroup')].filter(group=>!group.querySelector('.Interlude'));
  const shown=()=>groups().flatMap((group,index)=>group.classList.contains('ContextExcluded')?[]:[index]);
  const locals=()=>groups().map(group=>group.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop);
  window.scrollFixture={
   async initial(){await frame();tick(1.5,true);await frame();check(writes.length===0,'saved Off no initial/external-seek movement');check(shown().length===40,'Off reveals all and remembers counts');
    const before=writes.length;groups()[4].querySelector('.Vocals').click();await frame();check(seeks.length===1&&seeks[0]===17,'one inverse group-start seek');check(writes.length===before+1,'one synchronous seek/click recenter');
    emitSeek=false;const second=writes.length;groups()[4].querySelector('.Vocals').click();await frame();check(seeks.length===2&&writes.length===second+1,'paused same-position click still recenters once');emitSeek=true;
    // Real Spotify seek records intent before now() changes. Exercise browsing,
    // a focus/context reconciliation and stale ticks before acknowledgement.
    scroll.dispatchEvent(new Event('wheel'));asyncSeek=true;const third=writes.length;groups()[10].querySelector('.Vocals').click();await frame();
    const clicked=scroll.scrollTop;tick(time);set({before:2});scroll.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await frame();
    check(writes.length===third+1&&Math.abs(scroll.scrollTop-clicked)<1,'async Off browsing click moves exactly once before clock acknowledgement '+JSON.stringify({third,writes,clicked,actual:scroll.scrollTop}));
    tick(41,true);await frame();check(writes.length===third+1,'clock acknowledgement does not recenter twice');asyncSeek=false;
    const off=writes.length;tick(81.5,true);await frame();check(writes.length===off,'Off external seek remains stationary');
    set({follow:true,before:1});await frame();check(JSON.stringify(shown())===JSON.stringify([19,20,21]),'explicit On resumes finite active span');
    const coords=locals(),height=scroll.scrollHeight,position=scroll.scrollTop;set({before:0,after:0});await frame();check(JSON.stringify(shown())==='[20]','source groups only counts');check(scroll.scrollHeight===height&&locals().every((top,index)=>Math.abs(top-coords[index])<.1),'context preserves extent and coordinates');check(Math.abs(scroll.scrollTop-position)<.1,'context preserves viewport');
    const hidden=groups()[0];check(hidden.inert&&hidden.getAttribute('aria-hidden')==='true'&&getComputedStyle(hidden).visibility==='hidden','hidden context is inert and inaccessible');
    set({transition:'smooth'});tick(141.5,true);await wait(40);return this.wheelPoint();
   },
   wheelPoint(){const rect=scroll.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+Math.min(100,rect.height/2)}},
   async manual(){await wait(50);check(trustedWheel,'actual trusted wheel event');check(shown().length===40,'manual input reveals All');const at=scroll.scrollTop;await wait(70);check(Math.abs(scroll.scrollTop-at)<1,'manual input interrupts native smooth destination');
    // A longer edited deadline must replace the old timeout from the same last
    // actual manual event; async layout/activity cannot end it early.
    set({resumeDelay:1});tick(101.5);PresentationSettings.saveFontFamily('sans-serif');await wait(180);check(shown().length===40,'activity/font and old timeout do not cut edited delay short');
    // Expire in a real silent interval, then extend the existing deadline.
    // Old pending-resume state must not bypass the newly armed timer.
    tick(159.5);set({resumeDelay:0});await wait(30);check(shown().length===40,'silence expiry keeps manual position and All');
    set({resumeDelay:1});tick(105.5);await wait(30);check(shown().length===40,'new activity before extended silence deadline stays browsing');
    set({resumeDelay:0});await wait(30);check(shown().length<40,'shortened deadline resumes promptly');
    set({follow:false});return this.wheelPoint();
   },
   async anchor(){await wait(40);check(shown().length===40,'Off manual All');
    const index=groups().findIndex(group=>group.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top),before=groups()[index].getBoundingClientRect().top-scroll.getBoundingClientRect().top;
    set({primaryRatio:1.5});await frame();await frame();const after=groups()[index].getBoundingClientRect().top-scroll.getBoundingClientRect().top;check(Math.abs(after-before)<1,'font reflow preserves first visible group local reading position');
    set({follow:true});await frame();check(shown().length<40,'Off to On explicitly exits browsing');
    renderer.Destroy();const count=writes.length;tick(121.5,true);await wait(250);check(writes.length===count&&consumers.size===0,'destroy cancels listener and pending movement');Element.prototype.scrollTo=original;return 'SCROLL_BROWSER_PASS';
   }
  };
  jelTestComplete('SCROLL_BROWSER_READY');
 })();`;
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-scroll-')));
 try{
  const file=path.join(directory,'fixture.html');await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}body{margin:0;font-family:sans-serif}.shell{width:420px;height:340px;container-type:size}.ContentContainer{width:420px;height:340px;container-type:size}.Lyrics{width:420px;--minimum-lyrics-size:32px;--maximum-lyrics-size:32px;margin-top:80px;margin-bottom:180px}.LyricsScrollContainer{width:420px;height:340px}</style><div class="shell"><div class="ContentContainer"></div></div><script>${script.replaceAll('</script','<\\/script')}</script>`);
  const outcome=await runFocusedFixture(chrome,file,path.join(directory,'profile'),async command=>{
   const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value};
   const wheel=async point=>{await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:90})};
   await wheel(await evaluate('scrollFixture.initial()'));await wheel(await evaluate('scrollFixture.manual()'));assert.equal(await evaluate('scrollFixture.anchor()'),'SCROLL_BROWSER_PASS');
  });assert.equal(outcome,'SCROLL_BROWSER_READY');
 }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-scroll-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
