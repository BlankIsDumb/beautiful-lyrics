import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('all conversions retain source owners, moving springs, honest emphasis and disabled-resource cleanup', {skip:!chrome}, async()=>{
  const {code,css}=await buildVocalFixture(undefined,false,true);
  const script=`(async()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,ConvertVoice,ClassicRendering,ApplyTextPreset,LayoutVoice,CreateRenderingCounters}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[];
    const minimal=ApplyTextPreset({...ClassicRendering},'minimal');
    const shell=document.createElement('div');shell.className='Lyrics NaturallyAlignedLeft';shell.style.cssText='width:700px;--minimum-lyrics-size:32px;--maximum-lyrics-size:32px';document.body.append(shell);
    const makeDoc=texts=>{const part={StartTime:1,EndTime:9,Syllables:texts.map(([Text,StartTime,EndTime])=>({Text,StartTime,EndTime,IsPartOfWord:true}))};return NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:9,Source:{HasWordSync:true},Content:[{Type:'Vocal',Lead:part,Background:[part]}]})};
    const mount=(doc,voice,profile=ClassicRendering)=>{const group=document.createElement('button');group.className='VocalsGroup';shell.append(group);const counts=CreateRenderingCounters(),v=new VocalController(group,doc,voice,{...profile},counts);owned.push(v);return {v,group,counts}};
    const springs=child=>child.Syllables.flatMap(run=>[run.LiveText,...(run.Type==='Letters'?run.Letters.map(letter=>letter.LiveText):[])]).flatMap(text=>Object.values(text.Springs||{})).filter(Boolean);
    const state=child=>springs(child).map(s=>({spring:s,position:s.Position,velocity:s.Velocity,final:s.Final}));
    const unchanged=(before,child,label)=>{const after=springs(child);check(before.length===after.length,label+' spring count');before.forEach((s,i)=>check(s.spring===after[i]&&Math.abs(s.position-after[i].Position)<1e-14&&Math.abs(s.velocity-after[i].Velocity)<1e-14,label+' exact object/position/velocity'));};
    const warm=v=>{v.Animate(0,0,true);for(let i=0;i<45;i++)v.Animate(1.2+i/60,1/60);};
    const kana=text=>text.replace(/[ァ-ヶ]/gu,char=>String.fromCharCode(char.charCodeAt(0)-96));
    const cases=[
      ['Japanese',[['て胸を',1,4],['焦がしてしまう',5,8],['。',9,9]], [{surface_form:'て'},{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:'焦がし',reading:'コガシ'},{surface_form:'てしまう'},{surface_form:'。'}]],
      ['Chinese',[['你好世界',1,4],['星空',5,8],['。',9,9]]],
      ['Korean',[['안녕하세요',1,4],['하늘',5,8],['.',9,9]]]
    ];
    try {
      for(const [language,texts,tokens] of cases)for(const role of [0,1])for(const form of language==='Japanese'?['kana','romaji']:['romaji']){
        const doc=makeDoc(texts),voice=doc.groups[0].voices[role],base=LayoutVoice(voice);
        const runs=language==='Japanese'?AlignJapanese(voice,tokens,form,(reading,f)=>f==='kana'?kana(reading):({ムネ:'mune',コガシ:'kogashi'}[reading]||reading)):await ConvertVoice(voice,language,{languages:[language],japaneseForm:'romaji'},new AbortController().signal);
        const label=language+'/'+role+'/'+form;
        check(runs.length===base.length,label+' canonical source count');
        check(JSON.stringify(runs.map(run=>run.SourceOwners))===JSON.stringify(base.map(run=>run.SourceOwners)),label+' canonical source identities');
        check(JSON.stringify(runs.map(run=>run.Intervals))===JSON.stringify(base.map(run=>run.Intervals)),label+' exact intervals including point/gap');
        const {v,group}=mount(doc,voice);
        check(v.child.LastTime===undefined,label+' starts before first scheduled playback');v.SetProjection(runs,0);
        check(v.child.LastTime===0&&v.child.Syllables.every(run=>run.LiveText.Object.style.scale===String(run.LiveText.Springs.Scale.Position)&&run.LiveText.Object.style.getPropertyValue('--gradient-progress')==='-20%'),label+' pre-start replacement initializes new glyph CSS without a seek');
        check([...group.querySelectorAll('.Letter')].every(node=>getComputedStyle(node).willChange==='auto'),label+' converted glyphs request no whole-song prepromotion');
        v.SetProjection(base,0);warm(v);const primary=v.child,root=v.root,nodes=[...root.querySelectorAll('*')],moving=state(primary);
        check([...root.querySelectorAll('.Letter')].every(node=>getComputedStyle(node).willChange!=='auto'),label+' Original keeps established Classic hints');
        check(moving.some(s=>Math.abs(s.velocity)>1e-6),label+' test warmed real moving springs');
        const settings=NormalizeAnnotations();v.SetAnnotations(settings,runs,undefined,v.lastTime);
        unchanged(moving,v.child,label+' Above arrival');check(primary===v.child&&nodes.every((node,i)=>node===root.querySelectorAll('*')[i]),label+' primary DOM identity');
        check(group.querySelectorAll('.SecondaryText .Letter').length>0,label+' inherited reading emphasis');
        check([...group.querySelectorAll('.SecondaryText .Letter')].every(node=>getComputedStyle(node).willChange==='auto'),label+' secondary emphasis avoids whole-song glyph prepromotion');
        const custom=structuredClone(settings);custom.cases.Word={inherit:false,effects:{...ClassicRendering,emphasis:false}};
        v.SetAnnotations(custom,runs,undefined,v.lastTime);unchanged(moving,v.child,label+' reading-only custom edit');check(!group.querySelector('.SecondaryText .Letter'),label+' independent emphasis Off');
        v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,v.lastTime);unchanged(moving,v.child,label+' Above removal');
        const runSprings=primary.Syllables.map(run=>run.LiveText.Springs),before=runSprings.map(value=>Object.values(value||{}).map(s=>[s,s.Position,s.Velocity]));
        v.SetProjection(runs,v.lastTime);check(v.child===primary,label+' Replace retains canonical renderer');
        before.forEach((values,i)=>values.forEach(([spring,position,velocity],j)=>{const current=Object.values(primary.Syllables[i].LiveText.Springs)[j];check(current===spring&&Math.abs(position-current.Position)<1e-14&&Math.abs(velocity-current.Velocity)<1e-14,label+' Replace moving owner continuity')}));
        check(primary.Syllables[0].Type==='Letters',label+' Replace keeps source-selected emphasis despite spelling count');
        v.SetProjection(base,v.lastTime);v.SetRendering(minimal,v.lastTime);
        check(springs(v.child).length===0&&!group.querySelector('.Letter'),label+' Off removes mounted resources');
        check([...v.child.ProjectionStates.values()].every(s=>!s.springs&&s.letters.length===0),label+' Off releases cached effect resources');
      }
      // Coarser source/detail modes never gain invented word/letter effects.
      // Include unchanged Latin alongside each conversion rather than testing
      // only homogeneous dictionary output.
      for(const language of ['Japanese','Chinese','Korean']) {
        const text={Japanese:'胸を A',Chinese:'星空 A',Korean:'하늘 A'}[language];
        const project=async voice=>language==='Japanese'?AlignJapanese(voice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:' '},{surface_form:'A'}],'kana',kana):ConvertVoice(voice,language,{languages:[language],japaneseForm:'romaji'},new AbortController().signal);
        for(const detail of ['forcedLine','trueLine','static']) {
          const doc=detail==='forcedLine'?makeDoc([[text,1,4],['.',5,8]]):detail==='trueLine'?NormalizeLyrics({Type:'Line',StartTime:1,EndTime:8,Content:[{Type:'Vocal',Text:text,StartTime:1,EndTime:8}]}):NormalizeLyrics({Type:'Static',Lines:[{Text:text}]});
          const voice=doc.groups[0].voices[0];
          // Forced-Line has an extra genuine provider unit. Its punctuation is
          // part of the conversion input, so supply the complete token stream.
          const runs=language==='Japanese'&&detail==='forcedLine'?AlignJapanese(voice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:' '},{surface_form:'A'},{surface_form:'.'}],'kana',kana):await project(voice);
          check(runs.map(run=>run.Text).join('').includes('A'),language+'/'+detail+' unchanged mixed fragment survives');
          const {v,group,counts}=mount(doc,voice,{...ClassicRendering,detail:'line'});v.Animate(2,.1);
          v.SetAnnotations(NormalizeAnnotations(),runs,undefined,2);v.SetProjection(runs,2);
          check(!group.querySelector('.Letter,.Syllable'),language+'/'+detail+' never invents word emphasis');
          if(detail==='static')check(counts.springsAllocated===0&&!v.NeedsFrame()&&!v.RequiresContinuous(),language+' Static has no timed work');
          else check(v.child.Projection.Intervals.length>0,language+'/'+detail+' keeps real whole-source clock');
        }
        for(const [count,duration,expected] of [[3,.5,false],[13,2,false],[3,2,true]]) {
          const unit={Japanese:'あ',Chinese:'你',Korean:'안'}[language],text=unit.repeat(count),doc=makeDoc([[text,1,1+duration],['.',5,8]]),voice=doc.groups[0].voices[0];
          const runs=language==='Japanese'?AlignJapanese(voice,[{surface_form:text},{surface_form:'.'}],'kana',kana):await ConvertVoice(voice,language,{languages:[language],japaneseForm:'romaji'},new AbortController().signal);
          const {v}=mount(doc,voice);v.SetProjection(runs,1.2);check((v.child.Syllables[0].Type==='Letters')===expected,language+' preserves original duration/count eligibility '+count+'/'+duration);
        }
      }
      // A token crossing two genuine providers cannot be divided acoustically.
      // Its fallback keeps the source owners advancing, including their momentum.
      const doc=makeDoc([['漢',1,2],['字',4,5]]),voice=doc.groups[0].voices[0],a=mount(doc,voice).v,b=mount(doc,voice).v;
      warm(a);warm(b);const canonical=a.child.Syllables.map(run=>run.LiveText.Springs);
      const merged=AlignJapanese(voice,[{surface_form:'漢字',reading:'カンジ'}],'romaji',()=> 'kanji');
      check(merged.length===1&&merged[0].SourceOwners.length===2,'honest complete merged fallback');
      a.SetProjection(merged,a.lastTime);check(a.child.Syllables[0].Type==='Syllable','ambiguous merged mapping uses grouped emphasis');
      for(let i=0;i<150;i++){const time=2+i/60;a.Animate(time,1/60);b.Animate(time,1/60);}
      for(let i=0;i<330;i++){
        const time=4.5+i/60;
        if(time<=voice.end||a.NeedsFrame())a.Animate(time,1/60);
        if(time<=voice.end||b.NeedsFrame())b.Animate(time,1/60);
        check(!b.NeedsFrame()||a.NeedsFrame(),'merged fallback remains scheduled until hidden canonical effects settle');
      }
      a.SetProjection(LayoutVoice(voice),10);
      a.child.Syllables.forEach((run,i)=>{for(const key of ['Scale','YOffset','Glow']){const actual=run.LiveText.Springs[key],expected=b.child.Syllables[i].LiveText.Springs[key];check(actual===canonical[i][key]&&Math.abs(actual.Position-expected.Position)<1e-10&&Math.abs(actual.Velocity-expected.Velocity)<1e-10,'hidden canonical state advances through merged display')}});
      a.Animate(1.3,0,true);check(springs(a.child).every(s=>s.Position===s.Final&&s.Velocity===0),'genuine seek retains intentional immediate state');
      // Multiple attached readings in ONE source owner never restart 0..100%.
      const rubyDoc=makeDoc([['胸と彩を',1,4],['後',5,8]]),rubyVoice=rubyDoc.groups[0].voices[0],{v,group}=mount(rubyDoc,rubyVoice);
      const readings=AlignJapanese(rubyVoice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'と'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'を'},{surface_form:'後',reading:'アト'}],'kana',kana);
      warm(v);const before=state(v.child),primary=v.child;v.SetAnnotations(NormalizeAnnotations(),undefined,readings,v.lastTime);v.MeasureAnnotations();unchanged(before,v.child,'ruby arrival/layout');
      check(v.child===primary&&group.querySelector('.RubyReading .Letter'),'ruby preserves primary and safe reading emphasis');
      check([...group.querySelectorAll('.RubyReading .Letter')].every(node=>getComputedStyle(node).willChange==='auto'),'attached emphasis avoids whole-song glyph prepromotion');
      const entries=v.ruby.entries.slice(0,2);check(entries[0].run.VisualRange.end===entries[1].run.VisualRange.start,'attached readings share continuous owner coordinate');
      v.Animate(2.1,0,true);const phases=entries.map(entry=>entry.child.Syllables[0].LiveText.Object.style.getPropertyValue('--gradient-progress'));check(phases[0]!==phases[1],'shared-owner reading fragments do not restart same fill');
      const readingState=state(entries[1].child),primaryState=state(v.child);entries[0].root.style.letterSpacing='10px';v.MeasureAnnotations(1);
      unchanged(primaryState,v.child,'paused metric edit primary');unchanged(readingState,entries[1].child,'paused metric edit reading momentum');
      const ownerPhase=(2.1-1)/3,range=entries[1].run.VisualRange,local=Math.max(0,Math.min(1,(ownerPhase-range.start)/(range.end-range.start))),paint=parseFloat(entries[1].child.Syllables[0].LiveText.Object.style.getPropertyValue('--gradient-progress'));
      check(Math.abs(paint-(-20+120*local))<1e-6,'paused changed metrics repaint existing reading immediately');
      let widthReads=0;
      for(const entry of v.ruby.entries){
        const measure=entry.root.getBoundingClientRect.bind(entry.root);
        entry.root.getBoundingClientRect=()=>{widthReads++;return measure()};
      }
      const custom=NormalizeAnnotations();custom.cases.Word={inherit:false,effects:{...ClassicRendering,emphasis:false}};
      v.SetAnnotations(custom,undefined,readings,v.lastTime);v.MeasureAnnotations(1);
      check(widthReads===v.ruby.entries.length,'reading emphasis change remeasures intrinsic width without font generation change');
      const measured=widthReads;v.MeasureAnnotations(1);check(widthReads===measured,'unchanged emphasis metrics remain cached');
      v.SetAnnotations(NormalizeAnnotations(),undefined,readings,v.lastTime);v.MeasureAnnotations(1);
      check(widthReads===measured+v.ruby.entries.length,'inherited emphasis restoration remeasures once');unchanged(primaryState,v.child,'reading emphasis typography edit primary');
      v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,v.lastTime);unchanged(primaryState,v.child,'ruby removal');
      for(const controller of owned.splice(0).reverse()) {
        controller.Destroy();
        if(controller.child.ProjectionStates)check(controller.child.ProjectionStates.size===0,'disposal releases canonical projection cache even when controller stays referenced');
      }
      jelTestComplete('CONVERSION_ANIMATION_PASS');
    }catch(error){jelTestComplete('CONVERSION_ANIMATION_FAIL: '+error.stack)}finally{owned.reverse().forEach(v=>v.Destroy())}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-conversion-animation-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}.Vocals,.Line{transition:none!important}</style><script>addEventListener('error',e=>jelTestComplete('INIT: '+e.message));addEventListener('unhandledrejection',e=>jelTestComplete('INIT: '+e.reason?.stack));</script><script>${script.replaceAll('</script','<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'CONVERSION_ANIMATION_PASS');
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-conversion-animation-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
