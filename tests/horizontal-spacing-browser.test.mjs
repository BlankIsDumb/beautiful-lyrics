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

test('signed surface columns retain fonts/owners, protect boundaries, measure live/probe gaps, and preserve nested ruby/Word alignment', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,true,false,true);
 const surfaces=['Extension/Source/LyricViews/Card/style.scss','Extension/Source/LyricViews/Page/style.scss','Extension/Source/Stylings/TypographyPreview.scss'].map(file=>sass.compile(file).css).join('\n');
 const script=`(async()=>{${code}
 const {VocalController,LyricsScroller,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,LayoutVoice,ClassicLayout,ClassicRendering,ApplyTextPreset,PresentationSettings,RegisterTypography,TypographyMeasured,CreateTypographyPreview}=fixtureModule;
 const check=(ok,message)=>{if(!ok)throw Error(message)},near=(a,b,message,tolerance=1.5)=>check(Math.abs(a-b)<=tolerance,message+' '+a+' / '+b);
 const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const minimal=ApplyTextPreset({...ClassicRendering},'minimal');
 let cases=0;
 // Bounded source excerpts from AUDIT-OPPOSITE-ALIGNMENT-2026-11-01:
 // Thai spotify:track:6OuMeKOWACC0acKVleXvTC group16 42.647–45.828,
 // 16 canonical spans / 15 continuation flags; Japanese group21 on
 // spotify:track:7CAbF0By0Fpnbiu6Xn5ZF7 89.204–91.185.
 // Full authenticated records were deliberately not cached. These synthetic
 // timing partitions preserve the audited owner topology, not a native replay.
 const thai='นี่ไม่ใช่เวลาที่จะมาคร่ำครวญถึงรักที่หวานกลับจาง';
 function source(direction,opposite){
  const chars=Array.from(thai),parts=Array.from({length:16},(_,i)=>chars.slice(Math.floor(i*chars.length/16),Math.floor((i+1)*chars.length/16)).join(''));
  return {Type:'Syllable',Source:{HasWordSync:true},NaturalAlignment:direction,StartTime:42.647,EndTime:91.185,Content:[
   {Type:'Vocal',OppositeAligned:opposite,Lead:{StartTime:42.647,EndTime:45.828,Syllables:parts.map((Text,i)=>({Text,StartTime:42.647+i*.1988125,EndTime:42.647+(i+1)*.1988125,IsPartOfWord:i<15}))}},
   {Type:'Vocal',OppositeAligned:opposite,Lead:{StartTime:89.204,EndTime:91.185,Syllables:[{Text:'この',StartTime:89.204,EndTime:89.7,IsPartOfWord:false},{Text:'見えない',StartTime:89.7,EndTime:90.4,IsPartOfWord:false},{Text:'世界',StartTime:90.4,EndTime:91.185,IsPartOfWord:false}]}}
  ]};
 }
 const parse=output=>{const match=output.textContent.match(/left gap ([0-9.]+) CSS px · right gap ([0-9.]+) CSS px · width ([0-9.]+) CSS px/);check(match,'measured readout '+output.textContent);return match.slice(1).map(Number)};
 try{
  for(const surface of ['Card','Contained','Fullscreen'])for(const direction of ['Left','Right'])for(const opposite of [false,true]){
   const width=surface==='Fullscreen'?document.documentElement.clientWidth:surface==='Card'?620:900,height=surface==='Fullscreen'?window.innerHeight:800;
   const host=document.createElement('div');host.className='SurfaceHost';host.style.cssText='width:'+width+'px;height:'+height+'px;position:relative;container-type:size';document.body.append(host);
   let parent,reservation;
   if(surface==='Card'){host.innerHTML='<div id="BeautifulLyrics-CardView"><div class="LyricsContent"><div class="ContentContainer"></div></div></div>';parent=host.querySelector('.ContentContainer')}
   else{host.classList.add('Root__main-view');host.innerHTML='<div class="BeautifulLyricsPage '+surface+'"><div class="Content"></div></div>';parent=host.querySelector('.Content');if(surface==='Fullscreen'){reservation=document.createElement('div');reservation.className='PlayPanelMouseArea';parent.append(reservation)}}
   const scrollHost=document.createElement('div');scrollHost.className='LyricsScrollContainer';const root=document.createElement('div');root.className='Lyrics NaturallyAligned'+direction;scrollHost.append(root);parent.append(scrollHost);
   const doc=NormalizeLyrics(source(direction,opposite)),groups=[],controllers=[];
   for(const group of doc.groups){const element=document.createElement('button');element.className='VocalsGroup'+(opposite?' AlignedOpposite':'');root.append(element);const voice=group.voices[0],controller=new VocalController(element,doc,voice,minimal);controllers.push(controller);groups.push({GroupContainer:element,Vocals:[controller],Role:'source'})}
   const runs=AlignJapanese(doc.groups[1].voices[0],[{surface_form:'この',reading:'コノ'},{surface_form:'見えない',reading:'ミエナイ'},{surface_form:'世界',reading:'セカイ'}],'kana',text=>text);
   controllers[1].SetAnnotations(NormalizeAnnotations(),undefined,runs,0);controllers[1].MeasureAnnotations();
   await frame();
   const beforeFont=parseFloat(getComputedStyle(root.querySelector('.Lead')).fontSize),stockGroup=groups[0].GroupContainer.getBoundingClientRect(),stockVoice=root.querySelector('.Lead').getBoundingClientRect();
   const canonical=[...root.querySelectorAll('.Syllable')];
   const view=surface==='Card'?'NowPlaying':'FullLyrics';PresentationSettings.saveHorizontalSpacing(surface,0);
   const scroller=new LyricsScroller(scrollHost,root,groups,true,false,undefined,{profile:{...ClassicLayout,follow:false,transition:'instant'},surface,reservation,spacing:()=>PresentationSettings.getEffectiveHorizontalSpacing(surface),measured:TypographyMeasured});
   const unregister=RegisterTypography(view,root,surface);
   const unsubscribe=PresentationSettings.subscribeHorizontalSpacing(changed=>{if(changed===surface)scroller.RefreshLayout()});
   const form=document.createElement('form'),output=document.createElement('output');form.append(output);document.body.append(form);
   const dispose=CreateTypographyPreview(form,new Map(),new Map([[surface,output]]));
   await frame();await frame();
   const scroll=scrollHost.querySelector('.simplebar-content-wrapper');check(scroll.clientHeight>0&&scroll.clientHeight<=height,'bounded actual Simplebar '+surface);
   near(groups[0].GroupContainer.getBoundingClientRect().width,stockGroup.width,'zero stock group width');near(root.querySelector('.Lead').getBoundingClientRect().width,stockVoice.width,'zero stock source width');
   for(const adjustment of [-100,-50,0,50,100]){
    PresentationSettings.saveHorizontalSpacing(surface,adjustment);await frame();await frame();
    const group=groups[0].GroupContainer.getBoundingClientRect(),box=root.getBoundingClientRect(),port=scroll.getBoundingClientRect(),style=getComputedStyle(root);
    check(root.dataset.columnAvailable==='true','column is measurable '+surface);
    const safeLeft=surface==='Fullscreen'?Math.max(box.left,reservation.getBoundingClientRect().right):Math.max(box.left,port.left),safeRight=Math.min(box.right,port.right);
    check(group.left>=safeLeft-1.5&&group.right<=safeRight+1.5,'protected physical column edges '+surface+' '+adjustment);
    if(adjustment===-100){near(group.left,safeLeft,'widest left '+surface);near(group.right,safeRight,'widest right '+surface)}
    near(parseFloat(getComputedStyle(root.querySelector('.Lead')).fontSize),beforeFont,'spacing preserves font/query basis',.01);
    check(canonical.every((node,index)=>node===root.querySelectorAll('.Syllable')[index]),'spacing preserves canonical source timing nodes');
    check(scroll.scrollWidth<=scroll.clientWidth+1,'no horizontal scroll overflow '+surface+' '+adjustment);
    const ruby=root.querySelector('.RubyVocals'),primary=ruby.querySelector('.RubyPrimary');near(primary.getBoundingClientRect().width,ruby.getBoundingClientRect().width,'AL01 nested ruby primary fills owner',.1);
    const word=groups[0].GroupContainer.querySelector('.Word'),voice=word.closest('.Vocals');check(getComputedStyle(word).justifyContent===getComputedStyle(voice).justifyContent,'AL02 nested Word inherits resolved voice justification');
    const wordRect=word.getBoundingClientRect(),rows=[];for(const syllable of word.querySelectorAll('.Syllable')){const rect=syllable.getBoundingClientRect();let row=rows.find(row=>Math.abs(row.top-rect.top)<2);if(!row){row={top:rect.top,left:rect.left,right:rect.right};rows.push(row)}else{row.left=Math.min(row.left,rect.left);row.right=Math.max(row.right,rect.right)}}
    if(adjustment===100)check(rows.length>=2,'actual nested Word wraps for alignment control');
    if(rows.length>1){const last=rows.at(-1),right=(getComputedStyle(voice).justifyContent==='flex-end')!==(getComputedStyle(voice).direction==='rtl');near(right?last.right:last.left,right?wordRect.right:wordRect.left,'AL02 final wrapped row follows outer alignment',beforeFont*.6)}
    const measured=parse(output);near(measured[0],group.left-box.left,'live left gap readout');near(measured[1],box.right-group.right,'live right gap readout');near(measured[2],group.width,'live width readout');check(output.textContent.includes('Live'),'mounted readout labelled Live');cases++;
   }
   scrollHost.style.height='0px';await frame();await frame();check(output.textContent.includes('unavailable'),'collapsed mounted viewport reports unavailable instead of stale/probe metrics');
   scrollHost.style.height='';await frame();await frame();check(root.dataset.columnAvailable==='true','reopened viewport remeasures '+surface+' '+direction+' '+opposite);check(output.textContent.includes('Live'),'reopened viewport refreshes measured live metrics '+surface+' '+direction+' '+opposite+' '+output.textContent);
   // Put an Above reading before the FIRST actual source in document order.
   // Its smaller .Vocals.Lead font must never become the primary-em clamp basis.
   const aboveRuns=LayoutVoice(doc.groups[0].voices[0]).map(run=>({...run,AnnotationDerived:true}));
   controllers[0].SetAnnotations({...NormalizeAnnotations(),secondarySize:.7},aboveRuns,undefined,0);
   const primaryBefore=root.querySelector('.RubyPrimary'),primaryNodes=[...primaryBefore.querySelectorAll('.Syllable')];
   controllers[1].SetAnnotations({...NormalizeAnnotations(),secondarySize:.7},runs,runs,0);scroller.RefreshLayout();await frame();await frame();
   const block=groups[1].GroupContainer.querySelector('.VoiceBlock'),nestedRuby=block.querySelector('.RubyVocals'),nestedPrimary=block.querySelector('.RubyPrimary'),reading=block.querySelector('.SecondaryText');
   near(nestedRuby.getBoundingClientRect().width,block.getBoundingClientRect().width,'AL01 nested VoiceBlock ruby fills owner',.1);near(nestedPrimary.getBoundingClientRect().width,nestedRuby.getBoundingClientRect().width,'AL01 nested primary is not narrowed twice',.1);
   near(reading.getBoundingClientRect().width,block.getBoundingClientRect().width,'Above reading has independent full owner width',.1);near(parseFloat(getComputedStyle(reading).fontSize),parseFloat(getComputedStyle(nestedPrimary).fontSize)*.7,'Above reading ratio remains independent',.1);
   check(nestedPrimary===primaryBefore&&primaryNodes.every((node,index)=>node===nestedPrimary.querySelectorAll('.Syllable')[index]),'adding owned Above block preserves canonical primary nodes');
   const firstBlock=groups[0].GroupContainer.querySelector('.VoiceBlock'),firstSource=firstBlock.querySelector('.Vocals:not(.AnnotationText)'),firstReading=firstBlock.querySelector('.AnnotationText');
   check(firstBlock.firstElementChild===firstReading,'Above control precedes the first real source in metric-query order');
   const primarySize=parseFloat(getComputedStyle(firstSource).fontSize),sourceWidth=firstSource.getBoundingClientRect().width,fraction=opposite ? .75 : .95;
   near(parseFloat(getComputedStyle(firstReading).fontSize),primarySize*.7,'first Above row is smaller than source');
   if(stockGroup.width*fraction>=primarySize*4)near(sourceWidth,primarySize*4,'Above+100 keeps four actual primary-font em',1.5);
   else near(sourceWidth,stockGroup.width*fraction,'Above+100 retains already narrower default source',1.5);

   // Unregister only the measurement registration. The actual host remains so
   // the tiny probe sees precisely the same surface size, with no timed owners.
   unregister();TypographyMeasured();await frame();await frame();
   const predicted=parse(output),actual=groups[0].GroupContainer.getBoundingClientRect(),box=root.getBoundingClientRect();
   // With no mounted document the probe cannot infer opposite alignment. Its
   // .95 default is exact for ordinary groups; live .75 coverage is above.
   if(!opposite){near(predicted[0],actual.left-box.left,'preview left parity');near(predicted[1],box.right-actual.right,'preview right parity');near(predicted[2],actual.width,'preview width parity')}
   check(output.textContent.includes('Preview at this window size'),'unmounted readout labelled preview');
   dispose();check(!document.querySelector('.JEL-TypographyPreview'),'probe disposal');form.remove();unsubscribe();scroller.Destroy();controllers.forEach(controller=>controller.Destroy());host.remove();
  }
  check(cases===60,'complete surface/direction/opposite/spacing matrix');jelTestComplete('HORIZONTAL_BROWSER_PASS '+cases);
 }catch(error){jelTestComplete('HORIZONTAL_BROWSER_FAIL '+error.stack)}
})();`;
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-horizontal-')));
 try{const file=path.join(directory,'fixture.html');await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}${surfaces}body{margin:0;font-family:sans-serif}.SurfaceHost{--spice-sidebar:#222}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'HORIZONTAL_BROWSER_PASS 60');}
 finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-horizontal-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
