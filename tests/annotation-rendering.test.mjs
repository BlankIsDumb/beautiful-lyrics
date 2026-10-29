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
    const spans=['漢','字','  e','\u0301','👩','\u200d','💻','日本語','。'].map((Text,i)=>({Text,StartTime:i===0?1:i===1?4:i+4,EndTime:i===0?2:i===1?5:i+4.5,IsPartOfWord:i<8}));
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
      check(group.querySelector('rt').textContent==='かんじ','romaji secondary projects kana ruby rather than Latin reading');
      check(group.querySelectorAll('.RubyVocals').length===3&&group.querySelectorAll('rt').length===6,'ruby stays inside its own real voice');
      check(group.offsetHeight>initialHeight,'combined rows/ruby enlarge measured group');
      check(controllers.every(v=>v.GetScrollTarget().Element.classList.contains('VoiceBlock')),'overlap scroll targets whole combined voice');

      const checkRubyBounds=()=>{for(const rt of group.querySelectorAll('rt')){
        const range=document.createRange();range.selectNodeContents(rt.querySelector('.Synced'));
        const glyph=range.getBoundingClientRect(),owner=rt.closest('.RubyVocals').getBoundingClientRect(),bounds=group.getBoundingClientRect();
        check(glyph.width>0&&glyph.height>0&&glyph.top>=owner.top-1&&glyph.bottom<=owner.bottom+1,'real reading glyph bounds fit primary ruby reserve for lead and backing');
        check(glyph.top>=bounds.top-1&&glyph.bottom<=bounds.bottom+1,'real reading glyph bounds fit measured group');
      }};
      const wideWidth=roots[0].getBoundingClientRect().width,wideHeight=roots[0].getBoundingClientRect().height;checkRubyBounds();shell.style.width='180px';scroller.RefreshAnnotationLayout();await frame();await frame();check(roots[0].getBoundingClientRect().width<wideWidth*.7,'actual lyric width shrinks with viewport');check(roots[0].getBoundingClientRect().height>wideHeight+5,'narrow source actually wraps into additional ruby rows');checkRubyBounds();shell.style.width='400px';await frame();await frame();
      const sourceText=BuildVoiceText(doc.groups[0].voices[0]).text;
      for(const root of roots){const copy=root.cloneNode(true);copy.querySelectorAll('rt').forEach(rt=>rt.remove());check(copy.textContent===sourceText,'exact original base text including spaces, combining marks, emoji and punctuation');check(!root.style.getPropertyValue('--text-blur'),'neutral ruby owner retains no blur');}
      check(JSON.stringify(doc)===sourceSnapshot,'immutable source and all timing survive');
      check(counts.springsAllocated===0&&counts.springUpdates===0&&counts.effectWrites===0,'all Off annotations allocate/update/write zero effects');
      const v=controllers[0],rubyRoot=roots[0],secondary=group.querySelector('.SecondaryText');secondary.click();check(clicks===1,'secondary seeks source once');
      // Annotation effects cannot leak through primaryOff or primaryOn roots.
      const expressive=structuredClone(settings);expressive.cases.Word.effects={...minimal,highlight:'progressive',scale:true,verticalMotion:true,glow:true,blur:false};
      v.SetRendering({...minimal,blur:true},1.5);v.SetBlur(3);
      v.SetAnnotations(expressive,projected[0],projected[0],1.5);v.Animate(1.6,.1);
      const rt=rubyRoot.querySelector('rt'),reading=rt.querySelector('.Synced'),base=rubyRoot.querySelector('.RubyBase .Synced');
      check(getComputedStyle(base).backgroundImage==='none','primary Highlight Off remains solid');
      check(getComputedStyle(reading).backgroundImage!=='none'&&reading.style.getPropertyValue('--gradient-progress'),'reading Highlight On survives primary Off');
      check(getComputedStyle(base).scale==='none'&&getComputedStyle(reading).scale!=='none','reading Scale On is independent of primary Scale Off');
      check(getComputedStyle(rubyRoot.querySelector('.RubyBase')).filter==='blur(3px)','primary Blur On remains independent of reading Blur Off');
      check(getComputedStyle(rt).getPropertyValue('--text-blur').trim()==='0px'&&getComputedStyle(rt).filter==='none','reading Blur Off does not inherit previously blurred primary');
      const updates=counts.springUpdates;v.Animate(2,.1,true);const gapProgress=reading.style.getPropertyValue('--gradient-progress');v.Animate(3,.1,true);
      check(reading.style.getPropertyValue('--gradient-progress')===gapProgress,'grouped reading progress freezes in real source gap');
      check(counts.springUpdates>updates,'enabled independent reading springs run');
      v.SetRendering({...ClassicRendering},1.5);v.SetAnnotations(settings,projected[0],projected[0],1.5);v.Animate(1.6,.1);
      check(getComputedStyle(reading).backgroundImage==='none'&&getComputedStyle(reading).textShadow==='none'&&getComputedStyle(reading).scale==='none','reading Off survives expressive primary');
      const fontBefore=getComputedStyle(secondary).fontSize,primaryNodes=[...rubyRoot.querySelectorAll('.RubyBase')];
      v.SetAnnotations({...settings,secondarySize:1,gap:.5,spacing:.1,alignment:'center'},projected[0],projected[0],1.6);
      check(getComputedStyle(secondary).fontSize!==fontBefore&&getComputedStyle(secondary).justifyContent==='center','annotation typography/alignment apply immediately');
      check(primaryNodes.every(node=>node.isConnected),'style-only edit retains primary text nodes');
      const oldBlock=secondary.parentElement;
      const allocationBefore=counts.springsAllocated;v.SetRendering(minimal,1.6);v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,1.6);
      check(!rubyRoot.classList.contains('RubyVocals')&&rubyRoot.parentElement===group,'Off restores original primary DOM root');
      check(!secondary.isConnected,'Off removes secondary DOM');
      check(!rubyRoot.hasAttribute('data-annotation-align')&&!rubyRoot.style.getPropertyValue('--annotation-ruby-size')&&!oldBlock.hasAttribute('data-annotation-align')&&!oldBlock.style.getPropertyValue('--annotation-secondary-size'),'Off clears annotation-only state from restored root and detached prior block');
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
      line.SetAnnotations(settings,undefined,lineReadings,2);const copy=lineGroup.cloneNode(true);copy.querySelectorAll('rt').forEach(rt=>rt.remove());
      check(lineGroup.querySelectorAll('ruby').length===2&&copy.textContent===lineText,'one-span line ruby retains exact source at safe internal token boundaries');
      check(lineReadings.filter(r=>r.Reading).every(r=>r.StartTime===1&&r.EndTime===5&&r.Precision==='grouped'),'whole-line readings retain full source interval, no interpolation');
      const unsafe=projected[0].map(run=>run.Reading?{...run,Readings:[{...run.Reading,start:5,end:6}],Reading:{...run.Reading,start:5,end:6}}:run);
      v.SetAnnotations(settings,undefined,unsafe,2);const safeCopy=rubyRoot.cloneNode(true);safeCopy.querySelectorAll('rt').forEach(rt=>rt.remove());
      check(safeCopy.textContent===sourceText&&!rubyRoot.querySelector('rt'),'reading boundary inside combining grapheme emits no orphan rt and preserves entire original base');
      v.Destroy();secondary.click();check(clicks===1,'disposed row cannot seek');
      jelTestComplete('ANNOTATIONS_PASS');
    }catch(error){jelTestComplete('ANNOTATIONS_FAIL: '+error.stack)}finally{for(const object of owned)object.Destroy()}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-annotations-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><body><style>*{box-sizing:border-box}${css}.shell{width:400px;container-type:inline-size}.Lyrics{width:100%;height:900px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.LyricsScrollContainer{width:100%;height:500px}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);
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
        const copy=root.cloneNode(true);copy.querySelectorAll('rt').forEach(rt=>rt.remove());check(['あの夜君が僕に零した)','(君が零した)'].includes(copy.textContent),'exact native source survives');
        const bases=[...root.querySelectorAll('.RubyBase .Synced')].map(node=>({text:node.textContent,rect:node.getBoundingClientRect(),glyphs:glyphs(node)}));
        if(shell.clientWidth===1100){const bottoms=bases.flatMap(base=>base.glyphs.map(rect=>rect.bottom));check(Math.max(...bottoms)-Math.min(...bottoms)<1,'wide mixed kanji/kana source glyph baselines equal '+JSON.stringify(bases.map(base=>[base.text,base.rect.y,base.rect.bottom])));}
        const expectedFont=root.classList.contains('Background')?'42px':'56px';
        for(const base of root.querySelectorAll('.RubyBase'))check(getComputedStyle(base).fontSize===expectedFont,'source font is preserved across annotated and plain fragments');
        // Flex rows wrap at complete direct-child units. Detect the next row by
        // its horizontal reset, then compare every SOURCE glyph on that row;
        // rt positions alone cannot expose the earlier 66/49px baseline defect.
        const rows=[];let previousLeft=-Infinity;
        for(const unit of root.children){const rect=unit.getBoundingClientRect();if(!rows.length||rect.left<=previousLeft+1)rows.push([]);previousLeft=rect.left;const sourceUnits=unit.matches('.RubyBase')?[unit]:[...unit.querySelectorAll('.RubyBase')];rows.at(-1).push(...sourceUnits.flatMap(base=>glyphs(base)));}
        for(const row of rows){const bottoms=row.map(rect=>rect.bottom);check(Math.max(...bottoms)-Math.min(...bottoms)<1,'annotated kanji/plain kana share each normal wrapped source baseline '+JSON.stringify({width:shell.clientWidth,size:settings.rubySize,bottoms}));}

        const rtAll=[...root.querySelectorAll('rt')];
        for(const rt of rtAll){const rects=glyphs(rt);check(Math.max(...rects.map(r=>r.y))-Math.min(...rects.map(r=>r.y))<1,'rt is ONE horizontal visual line');const ruby=rt.closest('ruby').getBoundingClientRect(),bounds=root.getBoundingClientRect();check(ruby.width>=rt.getBoundingClientRect().width-2,'reading contributes intrinsic width');check(ruby.width<=bounds.width+2,'indivisible reading uniformly fits full voice width');}
        const tail=[...root.querySelectorAll('.RubyBase .Synced')].find(node=>node.textContent==='た)');check(tail,'captured trailing source grouping retained');const rects=glyphs(tail);check(Math.abs(rects[0].y-rects[1].y)<1,'native trailing た and ) baseline stays one line under border-box');
        const rb=root.querySelector('rb').getBoundingClientRect(),rt=root.querySelector('rt').getBoundingClientRect();check(rt.bottom<=rb.top+2,'reading visually above own kanji');
        const parent=root.getBoundingClientRect();for(const unit of root.querySelectorAll('ruby')){const r=unit.getBoundingClientRect();check(r.top>=parent.top-1&&r.bottom<=parent.bottom+1,'combined voice bounds include complete ruby');}
        const units=[...root.querySelectorAll('ruby')].map(node=>node.getBoundingClientRect());for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i],b=units[j];check(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'atomic reading units do not collide');}
      }
    };
    try{
      for(const width of [1100,240])for(const alignment of ['inherit','start','center','end'])for(const size of [.5,1]){
        shell.style.width=width+'px';settings={...settings,rubySize:size,spacing:.1,alignment};controllers.forEach((v,i)=>v.SetAnnotations(settings,undefined,readings[i],5));scroller.RefreshAnnotationLayout();await frame();await frame();verify();
        for(const ruby of group.querySelectorAll('ruby')){const rb=ruby.querySelector('rb').getBoundingClientRect(),rt=ruby.querySelector('rt').getBoundingClientRect();if(alignment==='start')check(Math.abs(rb.left-rt.left)<2,'Start aligns to source unit');if(alignment==='end')check(Math.abs(rb.right-rt.right)<2,'End aligns to source unit');if(alignment==='center'||alignment==='inherit')check(Math.abs((rb.left+rb.right)-(rt.left+rt.right))<3,'Center stays over source unit');}
      }
      const long=readings.map(runs=>runs.map(run=>run.Reading?{...run,Readings:run.Readings.map(reading=>({...reading,text:'きみ'.repeat(40)}))}:run));
      controllers.forEach((v,i)=>v.SetAnnotations(settings,undefined,long[i],5));scroller.RefreshAnnotationLayout();await frame();await frame();verify();check([...group.querySelectorAll('rt')].some(rt=>Number(rt.style.getPropertyValue('--ruby-fit'))<1),'last resort fit exercised');
      const rt=group.querySelector('rt');rt.style.setProperty('--ruby-fit','1');document.fonts.dispatchEvent(new Event('loadingdone'));await frame();await frame();check(Number(rt.style.getPropertyValue('--ruby-fit'))<1,'same named font completion invalidates fit signature');
      const v=controllers[0];v.SetRendering({...profile,detail:'line'},5);v.SetAnnotations(settings,undefined,readings[0],5);v.Animate(5,0,true);
      const progress=[...group.querySelector('.RubyVocals').querySelectorAll('.Synced')].map(node=>node.style.getPropertyValue('--gradient-progress'));check(new Set(progress).size===1,'forced Line main and readings share complete voice progress');
      controllers.forEach(v=>v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,5));scroller.RefreshAnnotationLayout();await frame();await frame();check(!group.querySelector('rt'),'Off removes all readings');
      const generation=scroller.AnnotationFontGeneration;document.fonts.dispatchEvent(new Event('loadingdone'));await frame();await frame();check(scroller.AnnotationFontGeneration===generation&&!scroller.AnnotationFontWatching,'Off releases font listener and queues no font work');
      jelTestComplete('RUBY_NATIVE_FIXTURE_PASS');
    }catch(error){jelTestComplete('RUBY_NATIVE_FIXTURE_FAIL: '+error.stack)}finally{owned.reverse().forEach(object=>object.Destroy())}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-ruby-native-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><body><style>*{box-sizing:border-box}${css}body{margin:0;font-family:${font}}.shell{width:1100px;container-type:inline-size}.Lyrics{width:100%;height:1600px;--minimum-lyrics-size:56px;--maximum-lyrics-size:56px}.LyricsScrollContainer{width:100%;height:800px}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'));assert.equal(result,'RUBY_NATIVE_FIXTURE_PASS',result);
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-ruby-native-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
