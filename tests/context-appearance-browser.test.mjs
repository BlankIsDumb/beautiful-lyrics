import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('muted context preserves real Word/Line/ruby/Above geometry, exclusions, focus safety and one seek', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,true,false,true,true);
 function setup(){
  const {LyricsRenderer,PresentationSettings,ClassicLayout,ClassicRendering,VocalController,LayoutVoice,NormalizeAnnotations}=fixtureModule;
  const check=(ok,message)=>{if(!ok)throw Error(message)},frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const controllers=new Set(),original=VocalController.prototype.PrepareSourceWrapping;
  VocalController.prototype.PrepareSourceWrapping=function(...args){controllers.add(this);return original.apply(this,args)};
  let state;
  window.contextFixture={async run(precision,annotation){
   controllers.clear();let time=13.5,asyncSeek=false;const consumers=new Set(),seeks=[],excluded={Animate:0,NeedsFrame:0,RequiresContinuous:0};
   const clock={now:()=>time,duration:()=>40,seek(t){seeks.push(t);if(!asyncSeek){time=t;for(const f of consumers)f(0,true)}},subscribe:f=>{consumers.add(f);return()=>consumers.delete(f)}};
   const tick=t=>{time=t;for(const f of consumers)f(1/60,true)};
   const set=value=>PresentationSettings.saveContextAppearance('NowPlaying',{...PresentationSettings.getContextAppearance('NowPlaying'),...value});
   PresentationSettings.resetLayout('NowPlaying','context');PresentationSettings.saveLayout('NowPlaying',{...ClassicLayout,transition:'instant',before:1,after:1});
   PresentationSettings.saveRendering('NowPlaying',precision==='Line'?'Line':'Word',{...ClassicRendering,detail:precision==='ForcedLine'?'line':'auto'});
   const host=document.createElement('div');host.className='host';document.body.append(host);
   const source={Type:precision==='Line'?'Line':'Syllable',Source:{HasWordSync:precision!=='Line'},NaturalAlignment:'Left',StartTime:1,EndTime:40,Content:Array.from({length:10},(_,i)=>precision==='Line'?{Type:'Vocal',Text:'漢字 source words '+i,StartTime:1+i*4,EndTime:3+i*4}:{Type:'Vocal',Lead:{StartTime:1+i*4,EndTime:3+i*4,Syllables:[{Text:'漢字',StartTime:1+i*4,EndTime:2+i*4,IsPartOfWord:false},{Text:' source words '+i,StartTime:2+i*4,EndTime:3+i*4,IsPartOfWord:false}]}})};
   const renderer=new LyricsRenderer(host,source,false,'NowPlaying',clock);await frame();
   if(annotation!=='Original')for(const v of controllers){const base=LayoutVoice(v.voice),settings=NormalizeAnnotations();if(annotation==='Above')v.SetAnnotations(settings,base.map(r=>({...r,Text:'reading',AnnotationDerived:true})),undefined,time);else v.SetAnnotations(settings,undefined,[{...base[0],AnnotationDerived:true,Readings:[{text:'かんじ',start:0,end:2}],Reading:{text:'かんじ',start:0,end:2}}],time);}
   await frame();await frame();tick(time);await frame();
   const root=host.querySelector('.Lyrics'),scroll=host.querySelector('.simplebar-content-wrapper'),groups=[...root.querySelectorAll('.VocalsGroup')].filter(n=>n.querySelector('.Vocals'));
   check(scroll.clientHeight===340&&parseFloat(getComputedStyle(groups[0].querySelector('.Vocals:not(.AnnotationText)')).fontSize)===32,'actual font/scrollport '+JSON.stringify({height:scroll.clientHeight,font:getComputedStyle(groups[0].querySelector('.Vocals:not(.AnnotationText)')).fontSize,precision,annotation}));check(groups.filter(g=>!g.classList.contains('ContextExcluded')).length===3,'1/1 source eligibility');
   for(const v of controllers)for(const name of Object.keys(excluded)){const old=v[name];v[name]=function(...args){if(this.GetScrollTarget().Element.closest('.ContextExcluded'))excluded[name]++;return old.apply(this,args)}}
   const bounds=()=>[...root.querySelectorAll('.VocalsGroup,.Vocals,.RubyVocals,.VoiceBlock')].map(n=>{const r=n.getBoundingClientRect();return [n,r.left,r.top+scroll.scrollTop,r.width,r.height]});
   const before=bounds(),nodes=[...root.querySelectorAll('.Syllable,.Line,.SourcePaint')];
   set({mode:'muted',blurEnabled:false,darkeningEnabled:false,opacity:35});await frame();
   const after=bounds();check(before.every((b,i)=>b[0]===after[i][0]&&b.slice(1).every((v,j)=>Math.abs(v-after[i][j+1])<.1)),'mode preserves geometry');check(nodes.every((n,i)=>n===[...root.querySelectorAll('.Syllable,.Line,.SourcePaint')][i]),'source identities unchanged');
   const ghost=groups[1];check(ghost.classList.contains('ContextExcluded')&&ghost.classList.contains('ContextMuted')&&!ghost.inert&&!ghost.hasAttribute('aria-hidden'),'paint separate from eligibility');check(getComputedStyle(ghost).visibility==='visible'&&getComputedStyle(ghost).filter==='none','neutral independent filters');
   const glyph=ghost.querySelector('.Synced');check(getComputedStyle(glyph).webkitTextFillColor==='rgb(255, 255, 255)'&&getComputedStyle(glyph).transform==='none'&&getComputedStyle(glyph).textShadow==='none','deterministic solid paint');check(getComputedStyle(root).maskImage==='none','no deferred gradient work');
   for(let i=0;i<20;i++){time+=.001;for(const f of consumers)f(1/60)}check(Object.values(excluded).every(n=>n===0),'excluded visual methods stopped');
   set({blurEnabled:true,blur:2,darkeningEnabled:true,darkening:60});check(getComputedStyle(ghost).filter==='blur(2px) brightness(0.4)','effects composed once on group');
   ghost.focus();await frame();check(Number(getComputedStyle(ghost).opacity)>=.6&&ghost.classList.contains('ContextExcluded'),'focus lightens without eligibility');
   set({opacity:80});check(Number(getComputedStyle(ghost).opacity)>=.8,'focus never reduces stronger opacity');set({opacity:0});await frame();check(!ghost.inert&&!ghost.hasAttribute('aria-hidden')&&Number(getComputedStyle(ghost).opacity)>=.6,'zero-opacity focused safety');
   groups[3].focus();await frame();check(ghost.inert&&ghost.getAttribute('aria-hidden')==='true'&&getComputedStyle(ghost).visibility==='hidden','zero opacity removes unfocused hit target');
   groups[3].blur();set({opacity:35});await frame();let count=seeks.length;asyncSeek=true;ghost.querySelector('.Vocals').click();await frame();check(seeks.length===count+1&&seeks.at(-1)===5,'child click one async seek');tick(5);await frame();check(!ghost.classList.contains('ContextExcluded'),'clicked source revealed at target');asyncSeek=false;
   tick(13.5);await frame();count=seeks.length;groups[0].click();await frame();check(seeks.length===count+1&&seeks.at(-1)===1,'native button own click one seek');
   tick(13.5);await frame();groups[0].style.filter='sepia(1)';set({mode:'hide'});check(groups[0].style.filter==='sepia(1)','leaving treatment preserves unrelated inline filter');groups[0].style.removeProperty('filter');check(groups[0].inert&&!groups[0].classList.contains('ContextMuted'),'Hide restores old interaction');
   set({mode:'muted'});PresentationSettings.saveLayout('NowPlaying',{...PresentationSettings.getLayout('NowPlaying'),follow:false});await frame();check(!root.querySelector('.ContextMuted')&&!root.querySelector('.ContextExcluded'),'Off bypasses all treatment');
   PresentationSettings.saveLayout('NowPlaying',{...PresentationSettings.getLayout('NowPlaying'),follow:true});await frame();
   const zero=NormalizeAnnotations();zero.opacity=0;for(const v of controllers)v.SetAnnotations(zero, v.secondaryRuns,v.rubyRuns,time);await frame();for(const reading of root.querySelectorAll('.ContextMuted .AnnotationText'))check(getComputedStyle(reading).opacity==='0','configured zero reading survives');
   renderer.Destroy();host.remove();check(consumers.size===0,'clock disposal');return true;
  },async nativeSetup(){
   let time=13.5;const consumers=new Set(),seeks=[];
   const clock={now:()=>time,duration:()=>40,seek:t=>{seeks.push(t);time=t;for(const f of consumers)f(0,true)},subscribe:f=>{consumers.add(f);return()=>consumers.delete(f)}};
   PresentationSettings.saveLayout('NowPlaying',{...ClassicLayout,before:1,after:1,transition:'instant'});PresentationSettings.saveContextAppearance('NowPlaying',{...PresentationSettings.getContextAppearance('NowPlaying'),mode:'muted',opacity:35});
   const host=document.createElement('div');host.className='host';document.body.append(host);
   const source={Type:'Line',NaturalAlignment:'Left',StartTime:1,EndTime:40,Content:Array.from({length:10},(_,i)=>({Type:'Vocal',Text:'Keyboard source '+i,StartTime:1+i*4,EndTime:3+i*4}))};
   const renderer=new LyricsRenderer(host,source,false,'NowPlaying',clock);await frame();await frame();
   const groups=[...host.querySelectorAll('.VocalsGroup')].filter(n=>n.querySelector('.Vocals'));groups[0].focus();await frame();await frame();
   check(groups[0].classList.contains('ContextExcluded'),'native offscreen focus stays excluded');
   state={host,renderer,groups,seeks,consumers,tick(){time=13.5;for(const f of consumers)f(0,true)}};return true;
  },async nativeReset(){PresentationSettings.saveLayout('NowPlaying',{...PresentationSettings.getLayout('NowPlaying'),follow:false});PresentationSettings.saveLayout('NowPlaying',{...PresentationSettings.getLayout('NowPlaying'),follow:true});state.tick();state.groups[0].focus();await frame();await frame();check(state.groups[0].classList.contains('ContextExcluded'),'reset retains excluded focus');const r=state.host.querySelector('.simplebar-content-wrapper').getBoundingClientRect();return {x:r.left+100,y:r.top+100};
  },async nativeCheck(kind){await frame();await frame();if(kind==='enter')check(state.seeks.length===1&&state.seeks[0]===1,'trusted Enter button activation seeks exactly once '+JSON.stringify({seeks:state.seeks,focused:document.activeElement?.outerHTML?.slice(0,200)}));else check(!state.host.querySelector('.ContextExcluded')&&state.host.querySelector('.LyricsScrollContainer').classList.contains('UserScrolling'),'explicit '+kind+' still enters manual browsing while muted focus held');return true;
  },nativeDestroy(){state.renderer.Destroy();state.host.remove();check(state.consumers.size===0,'native fixture cleanup');return true;}
  ,async fade(view){
   // Fade with distance: one flat per-line opacity, Fullscreen only.
   let time=42;const consumers=new Set();
   const clock={now:()=>time,duration:()=>90,seek:t=>{time=t;for(const f of consumers)f(0,true)},subscribe:f=>{consumers.add(f);return()=>consumers.delete(f)}};
   const tick=t=>{time=t;for(const f of consumers)f(1/60,true)};
   const set=value=>PresentationSettings.saveContextAppearance(view,{...PresentationSettings.getContextAppearance(view),...value});
   PresentationSettings.resetLayout(view,'context');PresentationSettings.saveLayout(view,{...ClassicLayout,transition:'instant',before:0,after:0});
   set({mode:'muted',opacity:35,fade:false,fadeLength:4,fadeEnd:0});
   const host=document.createElement('div');host.className='host';document.body.append(host);
   const source={Type:'Line',NaturalAlignment:'Left',StartTime:1,EndTime:90,Content:Array.from({length:20},(_,i)=>({Type:'Vocal',Text:'Fade source '+i,StartTime:1+i*4,EndTime:3+i*4}))};
   const renderer=new LyricsRenderer(host,source,false,view,clock);await frame();await frame();tick(time);await frame();
   const groups=[...host.querySelectorAll('.VocalsGroup')].filter(n=>n.querySelector('.Vocals'));check(groups.length===20,'twenty source slots');
   const prop=(g,name)=>g.style.getPropertyValue(name);
   const offValues=groups.filter(g=>g.classList.contains('ContextMuted')).map(g=>[prop(g,'--jel-context-hover-opacity'),prop(g,'--jel-context-filter')]);
   check(offValues.length===19&&offValues.every(v=>v[0]===offValues[0][0]&&v[1]===offValues[0][1]),'fade off paints every other line identically');
   check(groups.every((g,i)=>i===10||prop(g,'--jel-context-opacity')==='0.35'),'fade off keeps 0.35');
   set({fade:true});await frame();
   const expected=['0.35','0.2625','0.175','0.0875'];
   const verify=(active,label)=>{for(const [i,g] of groups.entries()){
    const d=Math.abs(i-active);if(d===0)continue;
    if(d<=4)check(g.classList.contains('ContextMuted')&&prop(g,'--jel-context-opacity')===expected[d-1]&&prop(g,'--jel-context-hover-opacity')===offValues[0][0]&&prop(g,'--jel-context-filter')===offValues[0][1]&&!g.inert,label+' distance '+d+' slot '+i+' '+prop(g,'--jel-context-opacity'));
    else check(!g.classList.contains('ContextMuted')&&g.inert&&g.getAttribute('aria-hidden')==='true'&&!prop(g,'--jel-context-opacity'),label+' beyond fade slot '+i);
   }};
   const snapshot=()=>groups.map((g,i)=>g.classList.contains('ContextMuted')+':'+prop(g,'--jel-context-opacity'));
   if(view==='FullLyrics')verify(10,'fade on');
   else check(groups.every((g,i)=>i===10||g.classList.contains('ContextMuted')&&prop(g,'--jel-context-opacity')==='0.35'),'Now Playing never fades');
   const beforeState=snapshot(),writes=new Map();
   for(const g of groups){const s=g.style,setProperty=s.setProperty.bind(s),removeProperty=s.removeProperty.bind(s);
    const log=name=>{if(name.startsWith('--jel-context'))writes.set(g,[...(writes.get(g)||[]),name])};
    s.setProperty=(name,...rest)=>{log(name);return setProperty(name,...rest)};s.removeProperty=name=>{log(name);return removeProperty(name)};}
   tick(46);await frame();
   if(view==='FullLyrics'){
    verify(11,'advanced');
    const afterState=snapshot();
    for(const [i,g] of groups.entries())check(writes.has(g)===(beforeState[i]!==afterState[i]),'only changed slots written, slot '+i+' '+JSON.stringify(writes.get(g)||[]));
    for(const i of [7,8,9,12,13,14])check(JSON.stringify(writes.get(groups[i]))==='["--jel-context-opacity"]','still-muted slot rewrites only its opacity '+i);
   }
   set({fade:false});await frame();
   check(groups.every((g,i)=>i===11||g.classList.contains('ContextMuted')&&prop(g,'--jel-context-opacity')==='0.35'),'fade off restores 0.35 everywhere');
   PresentationSettings.resetLayout(view,'context');renderer.Destroy();host.remove();check(consumers.size===0,'fade fixture cleanup');return true;
  }
  };jelTestComplete('CONTEXT_READY');
 }
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-context-')));
 try{const file=path.join(directory,'fixture.html');await writeFile(file,'<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}body{margin:0;background:#121212;color:white}.host{width:420px;height:340px;container-type:size;font-family:sans-serif}.LyricsScrollContainer{width:420px;height:340px}.Lyrics{width:420px;--minimum-lyrics-size:32px;--maximum-lyrics-size:32px}'+css+'.Lyrics{--minimum-lyrics-size:32px;--maximum-lyrics-size:32px}</style><script>'+(code+';('+setup.toString()+')();').replaceAll('</script','<\\/script')+'</script>');
 assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile'),async send=>{for(const precision of ['Word','Line','ForcedLine'])for(const annotation of ['Original','Above','Ruby']){const r=await send('Runtime.evaluate',{expression:`contextFixture.run(${JSON.stringify(precision)},${JSON.stringify(annotation)})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);assert.equal(r.result.value,true)}
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 await evaluate('contextFixture.nativeSetup()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await evaluate('contextFixture.nativeCheck("enter")');
 const point=await evaluate('contextFixture.nativeReset()');await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:40});await evaluate('contextFixture.nativeCheck("wheel")');
 await evaluate('contextFixture.nativeReset()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await evaluate('contextFixture.nativeCheck("ArrowDown")');await evaluate('contextFixture.nativeDestroy()');
 for(const view of ['FullLyrics','NowPlaying'])assert.equal(await evaluate(`contextFixture.fade(${JSON.stringify(view)})`),true);
 }),'CONTEXT_READY');
 }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-context-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
