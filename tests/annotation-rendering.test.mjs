import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildVocalFixture } from './renderer-fixture.mjs';
import { runFocusedFixture } from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('real annotation rows/ruby preserve source text, grouped gaps, independent effects and combined voice bounds', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture(undefined,true);
  const script=`(async()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,LayoutVoice,BuildVoiceText,ApplyTextPreset,ClassicRendering,CreateRenderingCounters,LyricsScroller,RenderScheduler}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[];
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const shell=document.createElement('div');shell.className='shell';
    const scroll=document.createElement('div');scroll.className='LyricsScrollContainer';shell.append(scroll);
    const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAlignedLeft';scroll.append(lyrics);document.body.append(shell);
    const minimal=ApplyTextPreset({...ClassicRendering},'minimal'),counts=CreateRenderingCounters();
    const spans=['漢','字','  e','\u0301','👩','\u200d','💻','日本語','。'].map((Text,i)=>({Text,StartTime:i===0?1:i===1?4:i+4,EndTime:i===0?2:i===1?5:i+4.5,IsPartOfWord:![1,3,6,8].includes(i)}));
    const part={StartTime:1,EndTime:12,Syllables:spans};
    const doc=NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:12,Content:[{Type:'Vocal',Lead:part,Background:[part,part]}]});
    const group=document.createElement('button');group.className='VocalsGroup AlignedOpposite';lyrics.append(group);
    const controllers=doc.groups[0].voices.map(voice=>{const v=new VocalController(group,doc,voice,minimal,counts);owned.push(v);return v});
    const sourceSnapshot=JSON.stringify(doc),roots=[...group.children];
    const tokens=[{surface_form:'漢字',reading:'カンジ'},{surface_form:'  '},{surface_form:'e\u0301'},{surface_form:'👩\u200d💻'},{surface_form:'日本語',reading:'ニホンゴ'},{surface_form:'。'}];
    const projected=doc.groups[0].voices.map(v=>AlignJapanese(v,tokens,'romaji',(reading,form)=>form==='kana'?({カンジ:'かんじ',ニホンゴ:'にほんご'}[reading]||reading):({カンジ:'kanji',ニホンゴ:'nihongo'}[reading]||reading)));
    const settings=NormalizeAnnotations({secondary:'romaji',ruby:true});
    settings.cases.Word={inherit:false,effects:{...minimal}};
    let clicks=0;controllers.forEach(v=>v.RequestedTimeSkip.Connect(()=>clicks++));
    const scroller=new LyricsScroller(scroll,lyrics,[{GroupContainer:group,Vocals:controllers}],true,false,counts);owned.push(scroller);
    const initialHeight=group.offsetHeight;
    try{
      controllers.forEach((v,i)=>v.SetAnnotations(settings,projected[i],projected[i],1.5));
      scroller.RefreshAnnotationLayout();await frame();await frame();
      check(group.querySelectorAll('.VoiceBlock').length===3&&group.querySelectorAll('.SecondaryText').length===3,'every real lead/backing voice owns one secondary row');
      check(group.querySelector('.RubyReading').textContent==='かんじ','romaji secondary projects kana ruby rather than Latin reading');
      check(group.querySelectorAll('.RubyVocals').length===3&&group.querySelectorAll('.RubyReading').length===6,'ruby stays inside its own real voice');
      check(group.offsetHeight>initialHeight,'combined rows/ruby enlarge measured group');
      check(controllers.every(v=>v.GetScrollTarget().Element.classList.contains('VoiceBlock')),'overlap scroll targets whole combined voice');

      const checkRubyBounds=()=>{for(const rt of group.querySelectorAll('.RubyReading')){
        const range=document.createRange();range.selectNodeContents(rt.querySelector('.Synced'));
        const glyph=range.getBoundingClientRect(),owner=rt.closest('.RubyVocals').getBoundingClientRect(),bounds=group.getBoundingClientRect();
        check(glyph.width>0&&glyph.height>0&&glyph.top>=owner.top-1&&glyph.bottom<=owner.bottom+1,'real reading glyph bounds fit primary ruby reserve for lead and backing');
        check(glyph.top>=bounds.top-1&&glyph.bottom<=bounds.bottom+1,'real reading glyph bounds fit measured group');
      }};
      const wideWidth=roots[0].getBoundingClientRect().width,wideHeight=roots[0].getBoundingClientRect().height;checkRubyBounds();shell.style.width='180px';scroller.RefreshAnnotationLayout();await frame();await frame();check(roots[0].getBoundingClientRect().width<wideWidth*.7,'actual lyric width shrinks with viewport');check(roots[0].getBoundingClientRect().height>wideHeight+5,'narrow source actually wraps into additional ruby rows');checkRubyBounds();shell.style.width='400px';await frame();await frame();
      const sourceText=roots[0].textContent; // Canonical Word DOM paints derived separators with CSS, like Original.
      for(const root of group.querySelectorAll('.RubyVocals')){const copy=root.cloneNode(true);copy.querySelectorAll('.RubyReading').forEach(rt=>rt.remove());check(copy.textContent===sourceText,'exact original base text including spaces, combining marks, emoji and punctuation');check(!root.style.getPropertyValue('--text-blur'),'neutral ruby owner retains no blur');}
      check(JSON.stringify(doc)===sourceSnapshot,'immutable source and all timing survive');
      check(counts.springsAllocated===0&&counts.springUpdates===0&&counts.effectWrites===0,'all Off annotations allocate/update/write zero effects');
      const v=controllers[0],rubyRoot=group.querySelector('.RubyVocals'),secondary=group.querySelector('.SecondaryText');secondary.click();check(clicks===1,'secondary seeks source once');
      // Annotation effects cannot leak through primaryOff or primaryOn roots.
      const expressive=structuredClone(settings);expressive.cases.Word.effects={...minimal,highlight:'progressive',scale:true,verticalMotion:true,glow:true,blur:false};
      v.SetRendering({...minimal,blur:true},1.5);v.SetBlur(3);
      v.SetAnnotations(expressive,projected[0],projected[0],1.5);v.Animate(1.6,.1);
      const rt=rubyRoot.querySelector('.RubyReading'),reading=rt.querySelector('.Synced'),base=rubyRoot.querySelector('.RubyPrimary .Synced');
      check(getComputedStyle(base).backgroundImage==='none','primary Highlight Off remains solid');
      check(getComputedStyle(reading).backgroundImage!=='none'&&reading.style.getPropertyValue('--gradient-progress'),'reading Highlight On survives primary Off');
      check(getComputedStyle(base).scale==='none'&&getComputedStyle(reading).scale!=='none','reading Scale On is independent of primary Scale Off');
      check(getComputedStyle(rubyRoot.querySelector('.RubyPrimary')).filter==='blur(3px)','primary Blur On remains independent of reading Blur Off');
      check(getComputedStyle(rt).getPropertyValue('--text-blur').trim()==='0px'&&getComputedStyle(rt).filter==='none','reading Blur Off does not inherit previously blurred primary');
      const updates=counts.springUpdates;v.Animate(2,.1,true);const gapProgress=reading.style.getPropertyValue('--gradient-progress');v.Animate(3,.1,true);
      check(reading.style.getPropertyValue('--gradient-progress')===gapProgress,'grouped reading progress freezes in real source gap');
      check(counts.springUpdates>updates,'enabled independent reading springs run');
      v.SetRendering({...ClassicRendering},1.5);v.SetAnnotations(settings,projected[0],projected[0],1.5);v.Animate(1.6,.1);
      check(getComputedStyle(reading).backgroundImage==='none'&&getComputedStyle(reading).textShadow==='none'&&getComputedStyle(reading).scale==='none','reading Off survives expressive primary');
      const fontBefore=getComputedStyle(secondary).fontSize,primaryNodes=[...rubyRoot.querySelectorAll('.RubyPrimary')];
      v.SetAnnotations({...settings,secondarySize:1,gap:.5,spacing:.1,alignment:'center'},projected[0],projected[0],1.6);
      check(getComputedStyle(secondary).fontSize!==fontBefore&&getComputedStyle(secondary).justifyContent==='center','annotation typography/alignment apply immediately');
      check(primaryNodes.every(node=>node.isConnected),'style-only edit retains primary text nodes');
      const oldBlock=secondary.parentElement;
      const allocationBefore=counts.springsAllocated;v.SetRendering(minimal,1.6);v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,1.6);
      check(!rubyRoot.isConnected&&roots[0].parentElement===group,'Off restores original primary DOM root');
      check(!secondary.isConnected,'Off removes secondary DOM');
      check(!roots[0].hasAttribute('data-annotation-align')&&!roots[0].style.getPropertyValue('--annotation-ruby-size')&&!oldBlock.hasAttribute('data-annotation-align')&&!oldBlock.style.getPropertyValue('--annotation-secondary-size'),'Off clears annotation-only state from restored root and detached prior block');
      v.SetAnnotations(settings,LayoutVoice(doc.groups[0].voices[0]),undefined,1.6);check(!group.querySelector('.VoiceBlock:first-child .SecondaryText'),'failed conversion source fallback creates no duplicate row');v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,1.6);secondary.click();check(clicks===1,'detached row listener is inert');
      const disabledUpdates=counts.springUpdates,disabledWrites=counts.effectWrites;
      const scheduler=new RenderScheduler(new Map([['voice',v]]),[{id:'voice',start:1,end:12}],new Map([['voice','voice']]),counts);
      for(const time of [2,2.1,3,4,4.2,8,13])scheduler.update(time,.1);
      check(counts.springUpdates===disabledUpdates&&counts.effectWrites===disabledWrites&&counts.springsAllocated===allocationBefore,'Off releases annotation effects and no work returns');
      // A source-line span can contain many safe ruby token boundaries. It keeps
      // that one original interval instead of inventing per-token timestamps.
      const lineText='  猫と犬 e\u0301 👩\u200d💻。',lineDoc=NormalizeLyrics({Type:'Line',StartTime:1,EndTime:5,Content:[{Type:'Vocal',Text:lineText,StartTime:1,EndTime:5}]});
      const lineVoice=lineDoc.groups[0].voices[0],lineGroup=document.createElement('button');lineGroup.className='VocalsGroup';lyrics.append(lineGroup);
      const line=new VocalController(lineGroup,lineDoc,lineVoice,minimal,counts);owned.push(line);
      const lineReadings=AlignJapanese(lineVoice,[{surface_form:'猫',reading:'ネコ'},{surface_form:'と',reading:'ト'},{surface_form:'犬',reading:'イヌ'},{surface_form:' '},{surface_form:'e\u0301'},{surface_form:' '},{surface_form:'👩\u200d💻'},{surface_form:'。'}],'kana',r=>r);
      line.SetAnnotations(settings,undefined,lineReadings,2);const copy=lineGroup.cloneNode(true);copy.querySelectorAll('.RubyReading').forEach(rt=>rt.remove());
      check(lineGroup.querySelectorAll('.RubyReading').length===2&&copy.textContent===lineText,'one-span line ruby retains exact source at safe internal token boundaries');
      check(lineReadings.filter(r=>r.Reading).every(r=>r.StartTime===1&&r.EndTime===5&&r.Precision==='grouped'),'whole-line readings retain full source interval, no interpolation');
      const unsafe=projected[0].map(run=>run.Reading?{...run,Readings:[{...run.Reading,start:5,end:6}],Reading:{...run.Reading,start:5,end:6}}:run);
      v.SetAnnotations(settings,undefined,unsafe,2);const safeOwner=roots[0],safeCopy=safeOwner.cloneNode(true);safeCopy.querySelectorAll('.RubyReading').forEach(rt=>rt.remove());
      check(safeCopy.textContent===sourceText&&!safeOwner.querySelector('.RubyReading'),'reading boundary inside combining grapheme emits no orphan rt and preserves entire original base');
      v.Destroy();secondary.click();check(clicks===1,'disposed row cannot seek');
      jelTestComplete('ANNOTATIONS_PASS');
    }catch(error){jelTestComplete('ANNOTATIONS_FAIL: '+error.stack)}finally{for(const object of owned)object.Destroy()}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-annotations-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}.shell{width:400px;container-type:inline-size}.Lyrics{width:100%;height:900px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.LyricsScrollContainer{width:100%;height:500px}</style><script>window.addEventListener("error",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.message+":"+event.lineno+":"+event.colno));window.addEventListener("unhandledrejection",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.reason?.stack));</script><script>${script.replaceAll('</script','<\\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'));
    assert.equal(result,'ANNOTATIONS_PASS',result);
  }finally{
    assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-annotations-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3});
  }
});


test('host border-box native backing tail and large atomic ruby retain horizontal readings, baseline, fit and detail parity', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture(undefined,true);
  // Captured Spotify tail at displayed 2:09: same 42px backing font on every
  // fragment, including the internally wrapping single source fragment "た)".
  // Host font stack is captured; installed font availability remains environment
  // dependent, and this controlled browser fixture does not certify native pixels.
  // Keep the previous effective sans-serif for the baseline geometry gate.
  // Actual inherited host-font bearings reproduce the SAME out-of-owner ruby
  // on frozen22 and Pass6 (font-classification.txt); that remains Pass7.
  const font='Nunito, "Zen Kaku Gothic Antique Medium", SOV_monomon, "Helvetica Neue", helvetica, arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, "MS Gothic", sans-serif';
  const script=`(async()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,ApplyTextPreset,ClassicRendering,LyricsScroller}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[];
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const shell=document.createElement('div');shell.className='shell';
    const scroll=document.createElement('div');scroll.className='LyricsScrollContainer';shell.append(scroll);
    const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAlignedLeft';scroll.append(lyrics);document.body.append(shell);
    const text=['あの','夜','君','が','僕','に','零','し','た)'];
    const syllables=text.map((Text,i)=>({Text,StartTime:i===0?1:i===1?2:i+3,EndTime:i===0?1.5:i===1?3:i+3.5,IsPartOfWord:true}));
    const part={StartTime:1,EndTime:12,Syllables:syllables};
    const backingPart={...part,Syllables:['(','君','が','零','し','た)'].map((Text,i)=>({...syllables[i],Text}))};
    const doc=NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:12,Content:[{Type:'Vocal',Lead:part,Background:[backingPart,part]}]});
    const group=document.createElement('button');group.className='VocalsGroup';lyrics.append(group);
    const profile={...ApplyTextPreset({...ClassicRendering},'minimal'),highlight:'progressive'};
    const controllers=doc.groups[0].voices.map(voice=>{const v=new VocalController(group,doc,voice,profile);owned.push(v);return v});
    const tokens=[{surface_form:'あの',reading:'アノ'},{surface_form:'夜',reading:'ヨル'},{surface_form:'君',reading:'キミ'},{surface_form:'が',reading:'ガ'},{surface_form:'僕',reading:'ボク'},{surface_form:'に',reading:'ニ'},{surface_form:'零し',reading:'コボシ'},{surface_form:'た',reading:'タ'},{surface_form:')'}];
    const kana=r=>({アノ:'あの',ヨル:'よる',キミ:'きみ',ガ:'が',ボク:'ぼく',ニ:'に',コボシ:'こぼし',タ:'た',し:'し'}[r]||r);
    const backingTokens=[{surface_form:'('},{surface_form:'君',reading:'キミ'},{surface_form:'が',reading:'ガ'},{surface_form:'零し',reading:'コボシ'},{surface_form:'た',reading:'タ'},{surface_form:')'}];
    const readings=doc.groups[0].voices.map((voice,index)=>AlignJapanese(voice,index===1?backingTokens:tokens,'kana',kana));
    let settings=NormalizeAnnotations({rubySize:.5});
    controllers.forEach((v,i)=>v.SetAnnotations(settings,undefined,readings[i],5));
    const scroller=new LyricsScroller(scroll,lyrics,[{GroupContainer:group,Vocals:controllers}],true,false);owned.push(scroller);
    const glyphs=element=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),rects=[];let node;while(node=walker.nextNode())for(let i=0;i<node.length;i++){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);rects.push(r.getBoundingClientRect())}return rects};
    const verify=()=>{
      for(const root of group.querySelectorAll('.RubyVocals')){
        const copy=root.cloneNode(true);copy.querySelectorAll('.RubyReading').forEach(rt=>rt.remove());check(['あの夜君が僕に零した)','(君が零した)'].includes(copy.textContent),'exact native source survives');
        const bases=[...root.querySelectorAll('.RubyPrimary .Synced')].map(node=>({text:node.textContent,rect:node.getBoundingClientRect(),glyphs:glyphs(node)}));
        if(shell.clientWidth===1100){const bottoms=bases.flatMap(base=>base.glyphs.map(rect=>rect.bottom));check(Math.max(...bottoms)-Math.min(...bottoms)<1,'wide mixed kanji/kana source glyph baselines equal '+JSON.stringify(bases.map(base=>[base.text,base.rect.y,base.rect.bottom])));}
        const expectedFont=root.classList.contains('Background')?'42px':'56px';
        for(const base of root.querySelectorAll('.RubyPrimary'))check(getComputedStyle(base).fontSize===expectedFont,'source font is preserved across annotated and plain fragments');
        // Primary remains its canonical Original DOM; annotation geometry must
        // not create a second source baseline or internally wrap the tail.
        const rtAll=[...root.querySelectorAll('.RubyReading')];
        for(const rt of rtAll.filter(rt=>!rt.parentElement.hidden)){const rects=glyphs(rt);check(Math.max(...rects.map(r=>r.y))-Math.min(...rects.map(r=>r.y))<1,'rt is ONE horizontal visual line');const ruby=rt.closest('.RubyAnnotation').getBoundingClientRect(),bounds=root.getBoundingClientRect();check(ruby.width>=rt.getBoundingClientRect().width-2,'neutral reading host contains its horizontal text');check(ruby.width<=bounds.width+2,'indivisible reading uniformly fits full voice width');}
        const tail=[...root.querySelectorAll('.RubyPrimary .Synced')].find(node=>node.textContent==='た)');check(tail,'captured trailing source grouping retained');const rects=glyphs(tail);check(Math.abs(rects[0].y-rects[1].y)<1,'native trailing た and ) baseline stays one line under border-box');
        const sourceTop=Math.min(...bases.flatMap(base=>base.glyphs.map(rect=>rect.top))),rt=root.querySelector('.RubyReading').getBoundingClientRect();check(rt.bottom<=sourceTop+2,'reading visually above first source glyph row');
        const parent=root.getBoundingClientRect();for(const unit of root.querySelectorAll('.RubyAnnotation:not([hidden])')){const r=unit.getBoundingClientRect();check(r.top>=parent.top-1&&r.bottom<=parent.bottom+1,'combined voice bounds include complete ruby '+JSON.stringify({width:shell.clientWidth,settings,root:root.className,parent:parent.toJSON(),unit:r.toJSON()}));}
        const units=[...root.querySelectorAll('.RubyAnnotation:not([hidden])')].map(node=>node.getBoundingClientRect());for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i],b=units[j];check(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'atomic reading units do not collide');}
      }
    };
    try{
      for(const width of [1100,240])for(const alignment of ['inherit','start','center','end'])for(const size of [.5,1]){
        shell.style.width=width+'px';settings={...settings,rubySize:size,spacing:.1,alignment};controllers.forEach((v,i)=>v.SetAnnotations(settings,undefined,readings[i],5));scroller.RefreshAnnotationLayout();await frame();await frame();verify();

      }
      const long=readings.map(runs=>runs.map(run=>run.Reading?{...run,Readings:run.Readings.map(reading=>({...reading,text:'きみ'.repeat(40)}))}:run));
      controllers.forEach((v,i)=>v.SetAnnotations(settings,undefined,long[i],5));scroller.RefreshAnnotationLayout();await frame();await frame();verify();check([...group.querySelectorAll('.RubyReading')].some(rt=>Number(rt.style.getPropertyValue('--ruby-fit'))<1),'last resort fit exercised');
      const rt=group.querySelector('.RubyReading');rt.style.setProperty('--ruby-fit','1');document.fonts.dispatchEvent(new Event('loadingdone'));await frame();await frame();check(Number(rt.style.getPropertyValue('--ruby-fit'))<1,'same named font completion invalidates fit signature');
      const v=controllers[0];v.SetRendering({...profile,detail:'line'},5);v.SetAnnotations(settings,undefined,readings[0],5);v.MeasureAnnotations();v.Animate(5,0,true);
      const phase=parseFloat(v.root.querySelector('.Synced').style.getPropertyValue('--gradient-progress'))/120;
      for(const entry of v.ruby.entries){const range=entry.run.VisualRange,expected=Math.max(0,Math.min(1,(phase-range.start)/(range.end-range.start)));check(Math.abs(parseFloat(entry.root.querySelector('.Synced').style.getPropertyValue('--gradient-progress'))/120-expected)<1e-6,'forced Line readings view one shared complete voice sweep');check(JSON.stringify(entry.child.Projection.Intervals)===JSON.stringify(v.child.Projection.Intervals),'forced Line reading keeps exact complete source interval union');}
      controllers.forEach(v=>v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,5));scroller.RefreshAnnotationLayout();await frame();await frame();check(!group.querySelector('.RubyReading'),'Off removes all readings');
      const generation=scroller.AnnotationFontGeneration;document.fonts.dispatchEvent(new Event('loadingdone'));await frame();await frame();check(scroller.AnnotationFontGeneration===generation+1&&!group.querySelector('.RubyReading'),'reading Off releases reading work while source typography still invalidates');
      scroller.Destroy();const disposedGeneration=scroller.AnnotationFontGeneration;document.fonts.dispatchEvent(new Event('loadingdone'));await frame();check(scroller.AnnotationFontGeneration===disposedGeneration,'renderer disposal releases the shared source/reading font listener');
      jelTestComplete('RUBY_NATIVE_FIXTURE_PASS');
    }catch(error){jelTestComplete('RUBY_NATIVE_FIXTURE_FAIL: '+error.stack)}finally{owned.reverse().forEach(object=>object.Destroy())}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-ruby-native-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}body{margin:0;font-family:${font}}.VocalsGroup{font-family:sans-serif!important}.shell{width:1100px;container-type:inline-size}.Lyrics{width:100%;height:1600px;--minimum-lyrics-size:56px;--maximum-lyrics-size:56px}.LyricsScrollContainer{width:100%;height:800px}</style><script>window.addEventListener("error",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.message+":"+event.lineno+":"+event.colno));window.addEventListener("unhandledrejection",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.reason?.stack));</script><script>${script.replaceAll('</script','<\\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'));assert.equal(result,'RUBY_NATIVE_FIXTURE_PASS',result);
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-ruby-native-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});


test('reading opacity multiplies its own role/highlight policy across timing, real hover and independent profiles', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture();
  const script=`(()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,ClassicRendering}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[],cases=[];
    const lyrics=document.createElement('div');lyrics.className='Lyrics';document.body.append(lyrics);
    const part={StartTime:1,EndTime:4,Syllables:[{Text:'漢字',StartTime:1,EndTime:2,IsPartOfWord:true},{Text:'かな',StartTime:3,EndTime:4,IsPartOfWord:false}]};
    const makeDoc=line=>NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:4,Source:{HasWordSync:!line},Content:[{Type:'Vocal',Lead:part,Background:[part]}]});
    const docs={Word:makeDoc(false),Line:makeDoc(true)};
    check(docs.Word.precision==='word'&&docs.Line.precision==='line','real source precision cases');
    const profile=(highlight,detail='auto',blur=false)=>({...ClassicRendering,highlight,detail,blur,scale:false,verticalMotion:false,glow:false,emphasis:false});
    const tokens=[{surface_form:'漢字',reading:'カンジ'},{surface_form:'かな',reading:'カナ'}];
    const convert=(reading,form)=>form==='kana'?({カンジ:'かんじ',カナ:'かな'}[reading]||reading):({カンジ:'kanji',カナ:'kana'}[reading]||reading);
    // The production Above/Replace adapters must both consume the absent-reading
    // fallback. Actual dictionary + utility behavior is covered in the pure test;
    // this small converter map isolates the real component projection wiring.
    for(const mode of ['above','replace']){
      const part={StartTime:1,EndTime:5,Syllables:[{Text:'ツ',StartTime:1,EndTime:2,IsPartOfWord:true},{Text:'ライ',StartTime:4,EndTime:5,IsPartOfWord:true}]};
      const document=NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:5,Content:[{Type:'Vocal',Lead:part,Background:[part]}]});
      const group=globalThis.document.createElement('button');group.className='VocalsGroup';lyrics.append(group);
      for(const voice of document.groups[0].voices){
        const controller=new VocalController(group,document,voice,profile('off'));owned.push(controller);
        const runs=AlignJapanese(voice,[{surface_form:'ツライ'}],'romaji',reading=>reading==='ツライ'?'tsurai':reading);
        if(mode==='above')controller.SetAnnotations(NormalizeAnnotations(),runs,undefined,0);else controller.SetProjection(runs,0);
      }
      const displayed=[...group.querySelectorAll(mode==='above'?'.SecondaryText':'.Vocals')];
      check(displayed.length===2&&displayed.every(node=>node.textContent==='tsurai'),'unknown kana fallback reaches '+mode+' for lead/backing');
      group.remove();
    }
    const policies=[...['classic','progressive','segment','off'].map(highlight=>({primary:highlight,inherit:true,reading:highlight})),...['classic','progressive','segment'].map(reading=>({primary:'off',inherit:false,reading})),{primary:'classic',inherit:false,reading:'off'}];
    const addCase=(mode,precision,policy,opacity)=>{
      const document=precision==='Line'?docs.Line:docs.Word;
      const primary=profile(policy.primary,precision==='ForcedLine'?'line':'auto');
      const group=globalThis.document.createElement('button');group.className='VocalsGroup';lyrics.append(group);
      const entry={mode,precision,policy,opacity,primary,group,controllers:[]};
      for(const voice of document.groups[0].voices){
        const controller=new VocalController(group,document,voice,primary);owned.push(controller);entry.controllers.push(controller);
        const projected=AlignJapanese(voice,tokens,mode.includes('romaji')?'romaji':'kana',convert);
        const settings=NormalizeAnnotations({opacity});
        if(!policy.inherit)for(const sourceCase of ['Word','Line'])settings.cases[sourceCase]={inherit:false,effects:profile(policy.reading,'auto',true)};
        if(mode==='furigana')controller.SetAnnotations(settings,undefined,projected,0);
        else if(mode.startsWith('above'))controller.SetAnnotations(settings,projected,undefined,0);
        else if(mode.startsWith('replace'))controller.SetProjection(projected,0);
        controller.Animate(0,0,true);controller.SetBlur(2);controller.MeasureAnnotations();
      }
      cases.push(entry);
    };
    for(const precision of ['Word','ForcedLine','Line']){
      for(const mode of ['furigana','above-kana','above-romaji'])for(const opacity of [0,.3,1])for(const policy of policies)addCase(mode,precision,policy,opacity);
      // Ordinary Original/Replace retain their existing alpha and hover policy.
      for(const mode of ['original','replace-kana','replace-romaji'])for(const highlight of ['classic','off'])addCase(mode,precision,{primary:highlight,inherit:true,reading:highlight},.3);
    }
    const factor=(role,state,highlight,hover)=>{
      if(highlight==='off'||hover||state==='active')return role==='lead'?1:.8;
      if(state==='idle')return role==='lead'?.51:.51*.53921568627;
      return role==='lead'?.497:.497*.6690140845;
    };
    const near=(actual,expected,message)=>check(Math.abs(actual-expected)<.00001,message+' expected '+expected+' got '+actual);
    const validate=(state,hover)=>{
      for(const entry of cases){
        const context=[entry.mode,entry.precision,entry.policy.primary,entry.policy.reading,entry.opacity,state,hover].join('/');
        check(entry.group.matches(':hover')===hover,'real CSS hover matching '+context);
        for(const node of entry.group.querySelectorAll('.Vocals')){
          const reading=node.classList.contains('AnnotationText'),role=node.classList.contains('Background')?'backing':'lead';
          const highlight=reading?entry.policy.reading:entry.policy.primary;
          const style=getComputedStyle(node),expected=factor(role,state,highlight,hover)*(reading?entry.opacity:1);
          near(Number(style.opacity),expected,'own opacity '+role+'/'+context);
          check(node.getAttribute('data-jel-highlight')===highlight,'independent profile attribute '+context);
          let effective=1;for(let parent=node;parent;parent=parent.parentElement)effective*=Number(getComputedStyle(parent).opacity);
          near(effective,expected,'neutral wrapper does not multiply primary opacity '+context);
          if(reading&&highlight==='off'&&!entry.policy.inherit){check(node.getAttribute('data-jel-blur')==='on'&&style.filter===(hover&&role==='lead'?'blur(0px)':'blur(2px)'),'independent blur remains enabled; existing lead-hover blur clearing is preserved '+context);check(getComputedStyle(node.querySelector('.Synced')).backgroundImage==='none','Highlight Off solid paint '+context);}
        }
      }
    };
    globalThis.opacityFixture={take(state,time,hover){for(const entry of cases)entry.controllers.forEach(controller=>controller.Animate(time,0,true));validate(state,hover)},switchProfiles(){
      for(const entry of cases){
        const before=[...entry.group.querySelectorAll('.Synced')];
        entry.policy={...entry.policy,primary:entry.policy.primary==='off'?'classic':'off'};
        if(entry.policy.inherit)entry.policy.reading=entry.policy.primary;
        entry.primary={...entry.primary,highlight:entry.policy.primary};entry.controllers.forEach(controller=>controller.SetRendering(entry.primary,0));
        check([...entry.group.querySelectorAll('.Synced')].every((node,index)=>node===before[index]),'profile switch retains text nodes '+entry.mode);
      }
      validate('idle',false);
    },finish(){owned.forEach(controller=>controller.Destroy());jelTestComplete('READING_OPACITY_PASS')}};
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-opacity-')));
  try{
    const file=path.join(directory,'fixture.html');
    // Remove transition interpolation only in this fixture, so each computed
    // style assertion checks its exact state target rather than wall-clock easing.
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}.Lyrics{width:700px;height:auto;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.Vocals{transition:none!important}</style><script>window.addEventListener("error",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.message+":"+event.lineno+":"+event.colno));window.addEventListener("unhandledrejection",event=>jelTestComplete("INITIALIZATION_FAIL: "+event.reason?.stack));</script><script>${script.replaceAll('</script','<\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'),async command=>{
      const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value};
      await evaluate('new Promise((resolve,reject)=>{let count=0;function ready(){if(globalThis.opacityFixture)return resolve(true);if(++count>120)return reject(Error("opacity fixture not initialized"));requestAnimationFrame(ready)}ready()})');
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      await command('DOM.enable');await command('CSS.enable');
      const {root}=await command('DOM.getDocument');const {nodeIds}=await command('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'.VocalsGroup'});
      for(const [state,time] of [['idle',0],['active',1.5],['sung',5]])await evaluate(`opacityFixture.take(${JSON.stringify(state)},${time},false)`);
      await Promise.all(nodeIds.map(nodeId=>command('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']})));
      for(const [state,time] of [['idle',0],['active',1.5],['sung',5]])await evaluate(`opacityFixture.take(${JSON.stringify(state)},${time},true)`);
      await Promise.all(nodeIds.map(nodeId=>command('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]})));
      await evaluate('opacityFixture.switchProfiles()');await evaluate('opacityFixture.take("active",1.5,false)');await evaluate('opacityFixture.take("sung",5,false)');
      await evaluate('opacityFixture.finish()');
    });
    assert.equal(result,'READING_OPACITY_PASS',result);
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-opacity-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
