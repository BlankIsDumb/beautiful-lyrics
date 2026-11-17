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
 const {code,css}=await buildVocalFixture(undefined,true,true,true,true);
 const surfaces=['Extension/Source/LyricViews/Card/style.scss','Extension/Source/LyricViews/Page/style.scss'].map(file=>sass.compile(file).css).join('\n');
 function setup(){
  const {LyricsRenderer,PresentationSettings,ClassicLayout,ClassicRendering,ApplyTextPreset}=fixtureModule;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check=(value,message)=>{if(!value)throw Error(message)};
  window.anchorFixture={async run(kind,precision,context,anchor,count=20,hostHeight=800){
   const host=document.createElement('div');host.style.cssText='width:'+(kind==='Card'?420:900)+'px;height:'+hostHeight+'px;position:relative;container-type:size';document.body.append(host);
   if(kind==='Card')host.innerHTML='<div id="BeautifulLyrics-CardView"><div class="Header" data-encore-id="type"><div class="Title">Lyrics</div><div class="BL-CardCredit" hidden></div></div><div class="LyricsContent"><div class="ContentContainer"></div></div></div>';
   else{host.classList.add('Root__main-view');host.innerHTML='<div class="BeautifulLyricsPage '+kind+'"><div class="Content"></div></div>';}
   const parent=host.querySelector(kind==='Card'?'.ContentContainer':'.Content'),view=kind==='Card'?'NowPlaying':'FullLyrics';
   const reservation=document.createElement('div');reservation.style.cssText='position:absolute;left:0;top:0;width:400px;height:800px';host.append(reservation);
   PresentationSettings.saveHorizontalSpacing(kind,0);
   PresentationSettings.saveLayout(view,{...ClassicLayout,transition:'instant',anchor,before:context,after:context,
    leading:count>=100?1.19:ClassicLayout.leading});
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
     check(spaces.length===2&&spaces[0]<=8&&spaces[1]<=8,'Card reserves only its own fade at song edges');
     check(groups.at(-1).getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom+.1,'Card paint clip contains the final group');
    }
    const H=scroll.clientHeight,top=Math.min(kind==='Card'?8:24,H/2),bottom=Math.min(kind==='Card'?8:64,Math.max(0,H-top-1)),A=top+(H-top-bottom)*anchor/100;
    const expectedCenter=(r,v)=>{const desired=Math.max(top+r.height/2,Math.min(H-bottom-r.height/2,A));if(kind!=='Card')return desired;const contentCenter=(r.top+r.bottom)/2-v.top+scroll.scrollTop;return contentCenter-Math.max(0,Math.min(scroll.scrollHeight-H,contentCenter-desired))};
    const tick=async(t,seek=false)=>{time=t;for(const fn of consumers)fn(1/60,seek||undefined);await frame()};
    const samples=[];
    for(const index of [...new Set([0,1,2,3,count-1])].filter(i=>i<count)){
     await tick(1.5+index*4);
     const target=groups[index].querySelector('.Vocals'),r=target.getBoundingClientRect(),v=scroll.getBoundingClientRect();
     if(kind==='Card' && r.height<=H-top-bottom) {
      const mask=parent.getBoundingClientRect();
      check(r.top>=mask.top+8-1.5&&r.bottom<=mask.bottom-8+1.5,'Card source stays inside its readable mask region');
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
    const checkTarget=element=>{const H=scroll.clientHeight,st=Math.min(8,H/2),sb=Math.min(8,Math.max(0,H-st-1)),A=st+(H-st-sb)*.45,r=element.getBoundingClientRect(),v=scroll.getBoundingClientRect();const center=(r.top+r.bottom)/2-v.top,contentCenter=center+scroll.scrollTop,expected=contentCenter-Math.max(0,Math.min(scroll.scrollHeight-H,contentCenter-A));check(Math.abs(center-expected)<1.5,'cue/source respects natural Card range '+JSON.stringify({r:r.toJSON(),v:v.toJSON(),A}));};
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
   try{await frame();await frame();const scroll=tallHost.querySelector('.simplebar-content-wrapper'),voice=tallHost.querySelector('.Vocals');const initial=scroll.scrollTop,r=voice.getBoundingClientRect(),v=scroll.getBoundingClientRect();check(r.height>scroll.clientHeight-16,'actually oversized');check(Math.abs(r.top-v.top-8)<1.5,'oversized voice top at readable top');time=3.2;for(const fn of consumers)fn(1/60);await frame();check(Math.abs(scroll.scrollTop-initial)<.1,'unchanged tall voice does not pan at segment boundary');}finally{tallRenderer.Destroy();tallHost.remove();}
   return true;
  },async profiles(surface){
   const view=surface==='Card'?'NowPlaying':'FullLyrics';
   const otherView=view==='NowPlaying'?'FullLyrics':'NowPlaying';
   const word={...ClassicRendering,animationEasing:'linear',animationResponse:'direct'};
   // A saved Line detail cannot switch a word-timed document back to Word.
   const line={...ApplyTextPreset(ClassicRendering,'minimal'),detail:'word',animationEasing:'ease-in',animationResponse:'slow'};
   const wordSource={Type:'Syllable',Source:{HasWordSync:true},NaturalAlignment:'Left',StartTime:1,EndTime:19,
    Content:[1,5,9,13,17].map(start=>({Type:'Vocal',Lead:{StartTime:start,EndTime:start+2,Syllables:[
     {Text:'你',StartTime:start,EndTime:start+1,IsPartOfWord:true},{Text:'好',StartTime:start+1,EndTime:start+2,IsPartOfWord:false},
    ]}}))};
   const lineSource={...wordSource,Type:'Line',Source:{HasWordSync:false},Content:wordSource.Content.map(({Lead})=>
    ({Type:'Vocal',Text:'你好',StartTime:Lead.StartTime,EndTime:Lead.EndTime}))};
   PresentationSettings.saveLayout(view,{...ClassicLayout,transition:'instant'});
   PresentationSettings.saveRendering(view,'Word',word);
   PresentationSettings.saveRendering(view,'Line',line);
   PresentationSettings.saveCues(view,{threshold:0,motion:false});
   const annotations=PresentationSettings.getAnnotations(view);
   annotations.cases.Word={inherit:false,effects:{...word,highlight:'segment'}};
   PresentationSettings.saveAnnotations(view,annotations);
   const conversions=PresentationSettings.getConversions(view);
   PresentationSettings.saveConversions(view,{...conversions,enabled:true,languages:{...conversions.languages,Chinese:{enabled:true,kind:'pinyin',placement:'above'}}});
   const seeks=[],owned=[];
   const mount=source=>{
    const host=document.createElement('div');host.style.cssText='width:900px;height:600px;position:relative;container-type:size';document.body.append(host);
    host.innerHTML=surface==='Card'?'<div id="BeautifulLyrics-CardView"><div class="Header">Lyrics</div><div class="LyricsContent"><div class="ContentContainer"></div></div></div>':
     '<div class="BeautifulLyricsPage '+surface+'"><div class="Content"></div></div>';
    const parent=host.querySelector('.ContentContainer,.Content');
    const clock={now:()=>5.5,duration:()=>19,seek:time=>seeks.push(time),subscribe:()=>()=>{}};
    const renderer=new LyricsRenderer(parent,source,false,view,clock,undefined,{surface});
    owned.push({host,renderer});
    return parent.querySelector('.Lyrics');
   };
   const active=root=>root.querySelectorAll('.Vocals.Lead:not(.SecondaryText)')[1];
   const reading=vocal=>vocal.closest('.VoiceBlock')?.querySelector('.SecondaryText');
   const effects=vocal=>['jelHighlight','jelScale','jelGlow','jelBlur','jelLineEasing','jelLineResponse'].map(key=>vocal.dataset[key]);
   try{
    const source=mount(wordSource),native=mount(lineSource),vocal=active(source);
    for(let attempt=0;attempt<60&&(!reading(vocal)||!reading(active(native)));attempt++)await frame();
    check(source.dataset.effectivePrecision==='word'&&vocal.dataset.jelScale==='on'&&reading(vocal)?.dataset.jelHighlight==='segment','Word starts with its own primary and reading effects');
    const wordReading=reading(vocal);
    annotations.cases.Line={inherit:false,effects:{...line,highlight:'progressive'}};
    PresentationSettings.saveAnnotations(view,annotations);
    check(reading(vocal)===wordReading&&wordReading.dataset.jelHighlight==='segment','inactive Line reading edit leaves Word DOM and effects intact');
    PresentationSettings.saveRendering(view,'Word',{...word,detail:'line'});
    const lineText=vocal.querySelector('.Line');
    check(active(source)===vocal&&source.dataset.effectivePrecision==='line'&&vocal.classList.contains('Active')&&lineText,'switch retains active source voice in '+surface);
    check(JSON.stringify(effects(vocal))===JSON.stringify(effects(active(native)))&&effects(vocal).join(',')==='off,off,off,off,,','forced and native Line use the same effects in '+surface+': '+effects(vocal));
    check(reading(vocal)?.dataset.jelHighlight==='progressive','switch uses Line reading override edited while Word was active');

    const liveLine={...line,scale:true,glow:true,blur:true,highlight:'segment',animationEasing:'ease-out',animationResponse:'fast'};
    PresentationSettings.saveRendering(view,'Line',liveLine);
    check(vocal.querySelector('.Line')===lineText&&effects(vocal).join(',')==='segment,on,on,on,ease-out,fast','live Line edits update all effects in place');
    check(getComputedStyle(lineText).transitionDuration==='0.05s','live Line response sets the real CSS transition');
    PresentationSettings.saveRendering(otherView,'Line',{...line,animationResponse:'direct'});
    PresentationSettings.saveRendering(view,'Word',{...word,detail:'line',glow:false});
    check(vocal.querySelector('.Line')===lineText&&effects(vocal).join(',')==='segment,on,on,on,ease-out,fast','other viewer and saved Word effects do not affect forced Line');
    annotations.cases.Line.inherit=true;
    PresentationSettings.saveAnnotations(view,annotations);
    check(reading(vocal)?.dataset.jelGlow==='on'&&reading(vocal)?.dataset.jelHighlight==='segment','inherited readings switch to the effective Line text profile');
    PresentationSettings.saveRendering(view,'Word',{...word,detail:'word',glow:false});
    check(source.dataset.effectivePrecision==='word'&&active(source)===vocal&&vocal.dataset.jelGlow==='off'&&reading(vocal)?.dataset.jelGlow==='on','Word restores its saved primary and independent reading effects');
    check(seeks.length===0,'appearance and detail changes never seek');
    vocal.click();
    check(seeks.length===1&&seeks[0]===5,'original source group is still the seek target');
   }finally{for(const {renderer,host} of owned){renderer.Destroy();host.remove();}}
  }};jelTestComplete('ANCHOR_READY');
 }
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-anchor-')));
 try{
  const file=path.join(directory,'fixture.html');await writeFile(file,'<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}.special .LyricsScrollContainer{width:100%;height:100%}.special .Lyrics{--minimum-lyrics-size:32px;--maximum-lyrics-size:32px}'+css+surfaces+'</style><script>'+(code+';('+setup.toString()+')();').replaceAll('</script','<\\/script')+'</script>');
  assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile'),async send=>{
   // Wait for the fixture script after navigation. The real converter bundle is
   // larger than the geometry fixture and can still be loading when CDP attaches.
   let ready=false;
   for(let attempt=0;attempt<60&&!ready;attempt++){
    ready=(await send('Runtime.evaluate',{expression:'Boolean(window.anchorFixture)'})).result.value;
    if(!ready)await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.ok(ready,'renderer fixture loaded');
   for(const kind of ['Card','Contained','Fullscreen']){
    const profiles=await send('Runtime.evaluate',{expression:`anchorFixture.profiles(${JSON.stringify(kind)})`,awaitPromise:true});if(profiles.exceptionDetails)throw Error(profiles.exceptionDetails.exception?.description||profiles.exceptionDetails.text);
   }
   for(const kind of ['Card','Contained','Fullscreen'])for(const precision of ['Word','Line','ForcedLine'])for(const context of [null,1,0])for(const anchor of [0,45,50,73.25,100]){
    const response=await send('Runtime.evaluate',{expression:`anchorFixture.run(${JSON.stringify(kind)},${JSON.stringify(precision)},${context},${anchor})`,awaitPromise:true,returnByValue:true});
    if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
   }
   for(const count of [1,20,160]) {
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
