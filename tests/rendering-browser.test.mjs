import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildVocalFixture} from './renderer-fixture.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('real controllers retain cases/lifetime; universal cue eligibility removes work/space without bypassing manual grace', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture(undefined,true);
  const script=`(async()=>{${code}
    const {VocalController,CueController,RenderScheduler,LyricsScroller,ClassicRendering,ApplyTextPreset,CreateRenderingCounters,NormalizeLyrics,LayoutVoice}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[];
    const shell=document.createElement('div');shell.className='shell';
    const scroll=document.createElement('div');scroll.className='LyricsScrollContainer';shell.append(scroll);
    const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAlignedLeft';scroll.append(lyrics);document.body.append(shell);
    const source=[{Text:'ก',StartTime:1,EndTime:1.5,IsPartOfWord:true},{Text:'ิ',StartTime:1.5,EndTime:2,IsPartOfWord:true},{Text:'ดี ',StartTime:3,EndTime:4,IsPartOfWord:false}];
    const part={StartTime:.75,EndTime:4,Syllables:source};
    const doc=NormalizeLyrics({Type:'Syllable',StartTime:.75,EndTime:4,Content:[{Type:'Vocal',Lead:part,Background:[part,part]}]});
    const counters=CreateRenderingCounters(),minimal=ApplyTextPreset({...ClassicRendering},'minimal');
    try{
      const group=document.createElement('button');group.className='VocalsGroup AlignedOpposite';lyrics.append(group);
      const controllers=doc.groups[0].voices.map(voice=>{const v=new VocalController(group,doc,voice,minimal,counters);owned.push(v);return v});
      const roots=[...group.querySelectorAll('.Vocals')];
      check(roots.length===3,'borrowed roots constructed without self-parenting');
      let clicks=0;controllers.forEach(v=>v.RequestedTimeSkip.Connect(()=>clicks++));
      const cueRoot=document.createElement('button');cueRoot.className='VocalsGroup';lyrics.append(cueRoot);
      const cue=new CueController(cueRoot,{Type:'Interlude',StartTime:0,EndTime:.75},{threshold:2,motion:false},counters,2);owned.push(cue);
      let cueSkips=0;cue.RequestedTimeSkip.Connect(()=>cueSkips++);cueRoot.querySelector('.Interlude').click();check(cueSkips===0,'static cue retains legacy non-seeking behavior');
      const visuals=new Map(controllers.map((v,i)=>['v'+i,v]));visuals.set('cue',cue);
      const intervals=[{id:'cue',start:0,end:.75},...controllers.flatMap((_,i)=>[{id:'v'+i,start:1,end:4},{id:'s'+i,start:3,end:4}])];
      const owners=new Map(intervals.map(row=>[row.id,row.id.startsWith('s')?'v'+row.id.slice(1):row.id]));
      const scheduler=new RenderScheduler(visuals,intervals,owners,counters);
      for(const t of [-1,0,.1,.5,.75,.8,1,1.1,2,2.5,3,3.1,4,4.1,4.1])scheduler.update(t,.1);
      check(counters.springsAllocated===0&&counters.springUpdates===0&&counters.effectWrites===0&&counters.continuousUpdates===0,'Minimal text plus explicitly static universal cue allocate/update/write zero effects');
      const scroller=new LyricsScroller(scroll,lyrics,[{GroupContainer:group,Vocals:controllers},{GroupContainer:cueRoot,Vocals:[cue]}],true,false,counters);owned.push(scroller);
      scroller.DetermineLyricBlur();check(counters.blurCalculations===0,'Blur Off skips activity/distance loop');
      controllers[0].Animate(1.25,0,true);
      let idle=getComputedStyle(roots[0]);const opacity=idle.opacity;
      controllers[0].Animate(5,0,true);
      check(getComputedStyle(roots[0]).opacity===opacity&&getComputedStyle(roots[0]).transitionDuration==='0s','Highlight Off has uniform opacity and no root transition');
      for(const root of roots) for(const span of root.querySelectorAll('.Synced'))check(getComputedStyle(span).backgroundImage==='none'&&getComputedStyle(span).textShadow==='none'&&getComputedStyle(span).webkitTextFillColor==='rgb(255, 255, 255)','Highlight/Glow Off render solid glyphs');
      // Mode changes replace only owned content. All roles, click listeners and
      // source identities survive with two backing voices and alternate runs.
      for(const detail of ['line','word','auto','line','word']){
        controllers.forEach((v,i)=>v.SetRendering({...minimal,detail},1.25));
        check(roots.every((root,i)=>group.querySelectorAll('.Vocals')[i]===root&&root.parentElement===group),'stable controller roots across detail switches');
        roots.forEach((root,i)=>{check(root.classList.contains(i?'Background':'Lead')&&!root.classList.contains(i?'Lead':'Background'),'one exact source voice role');root.click()});
      }
      check(clicks===15,'exactly one click signal per retained root');
      controllers.forEach((v,i)=>v.SetProjection(LayoutVoice(doc.groups[0].voices[i]),1.25));
      roots.forEach(root=>root.click());check(clicks===18,'projection retains click ownership');
      const preserved=[...roots[0].querySelectorAll('.Syllable')];
      controllers[0].SetRendering({...minimal,blur:true},1.25);scroller.SetBlurEnabled(true);
      controllers[0].SetBlur(2);
      check(getComputedStyle(roots[0]).filter==='blur(2px)','independent Blur On works on solid Highlight Off text');
      check(preserved.every(node=>node.isConnected),'blur edit does not rebuild text');
      scroller.SetBlurEnabled(false);const blurCalls=counters.blurCalculations;scroller.DetermineLyricBlur();
      check(counters.blurCalculations===blurCalls&&!roots[0].style.getPropertyValue('--text-blur'),'Blur Off clears once and then skips');
      controllers[0].SetRendering({...minimal,detail:'word',glow:true},1.25);
      const beforeUpdates=counters.springUpdates;controllers[0].Animate(1.4,.1);
      check(counters.springUpdates>beforeUpdates&&counters.springsAllocated>0,'independent glow allocates/updates only after enabled');
      controllers[0].SetRendering({...ClassicRendering},1.4);controllers[0].Animate(1.8,1/60);
      check(controllers[0].NeedsFrame(),'changed target creates real settling state');
      const beforeRepeat=counters.springUpdates;let repeats=0;
      while(controllers[0].NeedsFrame()&&repeats++<600)controllers[0].Animate(1.8,1/60);
      check(counters.springUpdates>beforeRepeat&&!controllers[0].NeedsFrame(),'Syllable index continues actual springs at repeated timestamps to sleep');
      controllers[0].SetRendering(minimal,1.4);const disabledUpdates=counters.springUpdates;
      controllers[0].Animate(1.6,.1);check(counters.springUpdates===disabledUpdates,'disabled springs released');
      // Whole-segment starts are inclusive, including the first instant.
      controllers[0].SetRendering({...minimal,highlight:'segment'},1);
      const first=roots[0].querySelector('.Synced');check(first.style.getPropertyValue('--gradient-progress')==='100%','whole segment fully highlights at its exact start');
      // Line Classic keeps legacy CSS scale and no new Y spring; all Off removes it.
      controllers[0].SetRendering({...ClassicRendering,detail:'line'},1.25);
      const line=roots[0].querySelector('.Line');check(getComputedStyle(line).scale==='1.05'&&!line.style.transform,'Classic Line scale and stationary Y baseline');
      controllers[0].SetRendering({...minimal,detail:'line'},1.25);
      check(getComputedStyle(line).scale==='none'&&getComputedStyle(line).transitionDuration==='0s','Line Scale Off removes inherited CSS effect');
      const staticDoc=NormalizeLyrics({Type:'Static',Lines:[{Text:'plain source'}]});const staticCounts=CreateRenderingCounters();
      const staticVocal=new VocalController(group,staticDoc,staticDoc.groups[0].voices[0],{...ClassicRendering},staticCounts);owned.push(staticVocal);
      staticVocal.Animate(5,.1);check(staticCounts.springsAllocated===0&&!staticVocal.RequiresContinuous(),'untimed source plain fallback has no animated state');
      const staticScroller=new LyricsScroller(scroll,lyrics,[{GroupContainer:group,Vocals:[staticVocal]}],false,false,staticCounts);owned.push(staticScroller);
      for(const profile of [{...ClassicRendering,detail:'line'},minimal,{...ClassicRendering,detail:'word'}]){
        staticVocal.SetRendering(profile,5);staticScroller.SetBlurEnabled(profile.blur);staticScroller.DetermineLyricBlur();
      }
      check(staticCounts.springsAllocated===0&&staticCounts.springUpdates===0&&staticCounts.blurCalculations===0&&staticCounts.effectWrites===0,'Static preset/detail edits do not allocate timed effects or derive blur');

      const wrapperDoc=NormalizeLyrics({Type:'Syllable',Source:{HasWordSync:false},StartTime:0,EndTime:4,Content:[{Type:'Vocal',Lead:{StartTime:0,EndTime:4,Syllables:source}}]});
      const wrapperCount=CreateRenderingCounters(),wrapper=new VocalController(group,wrapperDoc,wrapperDoc.groups[0].voices[0],{...ClassicRendering,detail:'auto'},wrapperCount);owned.push(wrapper);
      const wrapperRoot=group.querySelectorAll('.Vocals')[group.querySelectorAll('.Vocals').length-1];
      check(wrapperRoot.querySelector('.Line')&&!wrapperRoot.querySelector('.Syllable,.Letter')&&wrapperCount.springsAllocated===1,'Line-precision Syllable wrapper ignores saved Auto/word-only effects');
      wrapper.SetRendering({...ClassicRendering,detail:'word'},1.25);check(wrapperRoot.querySelector('.Line')&&!wrapperRoot.querySelector('.Letter'),'explicit saved Word never fabricates Line-source detail');
      // Hidden eligibility removes margins/blur slots and preserves manual grace
      // even after physical scrolling stops. Only this owned scroller is probed.
      cueRoot.style.marginTop='20px';cueRoot.style.marginBottom='30px';cue.SetSettings({threshold:2,motion:true},.5);
      check(cue.RequiresContinuous()&&cueRoot.querySelectorAll('.InterludeDot').length===3&&counters.springsAllocated>0,'eligible animated cue allocates real springs');
      scroller.AutoScrollBlocked=true;scroller.Scroller.isScrolling=false;
      let scrollWrites=0;const oldScrollTo=scroller.ScrollTo,oldElementScroll=scroller.ScrollerObject.scrollTo;
      scroller.ScrollTo=()=>scrollWrites++;scroller.ScrollerObject.scrollTo=()=>scrollWrites++;
      const nativeRAF=globalThis.requestAnimationFrame,nativeCancel=globalThis.cancelAnimationFrame,frames=new Map();let frameId=0;
      globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId};globalThis.cancelAnimationFrame=id=>frames.delete(id);
      const nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout,timers=new Map();let timerId=1000000;
      globalThis.setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId};globalThis.clearTimeout=id=>{if(!timers.delete(id))nativeClearTimeout(id)};
      const originalMove=scroller.MoveToActiveLyrics;let moveCalls=0;scroller.MoveToActiveLyrics=function(...args){moveCalls++;return originalMove.apply(this,args)};
      try{
        scroller.AutoScrolling=false;scroller.ScrollerObject.dispatchEvent(new Event('scroll'));
        const grace=[...timers].find(([,timer])=>timer.delay===750);check(!!grace,'actual scroll listener schedules existing750ms grace callback');
        cue.SetSettings({threshold:0,motion:true},.5);const afterDisable={updates:counters.springUpdates,writes:counters.effectWrites,allocations:counters.springsAllocated};scroller.RefreshCueLayout();
        cue.Animate(.6,.1);check(!cue.RequiresContinuous()&&!cue.NeedsFrame()&&!cueRoot.querySelector('.InterludeDot')&&counters.springUpdates===afterDisable.updates&&counters.effectWrites===afterDisable.writes&&counters.springsAllocated===afterDisable.allocations,'zero threshold destroys animated cue state and further effect work');
        await Promise.resolve(); // Flush ActivityChanged's queued active reconciliation.
        for(const callback of frames.values())callback();frames.clear();
        check(cueRoot.hidden&&getComputedStyle(cueRoot).display==='none'&&scroller.GroupDimensions[1].Height===0,'disabled cue contributes zero height including CSS margins');
        check(scrollWrites===0&&scroller.AutoScrollBlocked,'hiding active cue preserves manual-scroll grace after physical scroll stops');
        controllers.forEach(v=>v.Animate(-1,0,true)); // Existing timeout lands in silence.
        timers.delete(grace[0]);grace[1].callback();
        check(!scroller.PreserveManualGrace&&scroller.AutoScrollBlocked,'cue guard expires through existing grace timeout even without active voices');
        const movesAfterExpiry=moveCalls;controllers[0].Animate(1.25,0,true);await Promise.resolve();
        check(moveCalls>movesAfterExpiry,'later playback activity reaches normal scrolling policy after grace expiry');
      }finally{globalThis.requestAnimationFrame=nativeRAF;globalThis.cancelAnimationFrame=nativeCancel;globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClearTimeout;scroller.MoveToActiveLyrics=originalMove;scroller.ScrollTo=oldScrollTo;scroller.ScrollerObject.scrollTo=oldElementScroll}
      const cueCounts=CreateRenderingCounters(),tinyGroup=document.createElement('button');tinyGroup.className='VocalsGroup';lyrics.append(tinyGroup);
      const tiny=new CueController(tinyGroup,{Type:'Interlude',StartTime:1,EndTime:1.05},{threshold:.1,motion:true},cueCounts,.1);owned.push(tiny);tiny.Animate(1.01,.01,true);
      check(!tinyGroup.hidden&&tinyGroup.querySelectorAll('.StaticCue .InterludeDot').length===3&&!tiny.RequiresContinuous()&&cueCounts.springsAllocated===0,'tiny positive gap remains finite static dots');
      tiny.SetSettings({threshold:100,motion:true},1.01);const beforeDisabled=cueCounts.springUpdates;tiny.Animate(1.02,.01);
      check(tinyGroup.hidden&&!tinyGroup.querySelector('.InterludeDot')&&!tiny.NeedsFrame()&&cueCounts.springUpdates===beforeDisabled,'ineligible gap releases all cue state/work');
      const oldRoot=roots[0];controllers[0].Destroy();oldRoot.click();check(clicks===18&&!oldRoot.isConnected,'Destroy removes root/listener');
      document.body.textContent='RENDERING_PASS';
    }catch(error){document.body.textContent='RENDERING_FAIL: '+error.message}
    finally{for(const object of owned)object.Destroy()}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-render-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><body><style>${css}.shell{width:320px;container-type:inline-size}.Lyrics{width:320px;height:600px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.LyricsScrollContainer{width:320px;height:500px}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);
    const browser=spawnSync(chrome,['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(directory,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,windowsHide:true});
    assert.equal(browser.error,undefined,browser.error?.message);assert.equal(browser.status,0,browser.stderr);
    assert.match(browser.stdout,/RENDERING_PASS/,browser.stdout);assert.doesNotMatch(browser.stdout,/RENDERING_FAIL/);
  }finally{
    assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-render-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3});
  }
});
