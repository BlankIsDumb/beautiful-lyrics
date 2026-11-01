import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('wrapped canonical source retains true gaps/seeks, reading policies, moving owners and independent leading under theme fonts', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,false,false,true);
 const script=`(()=>{${code}
  const {VocalController,NormalizeLyrics,NormalizeAnnotations,LayoutVoice,ClassicRendering,ApplyTextPreset,ApplyLayoutStyle,ClassicLayout}=fixtureModule;
  const check=(ok,message)=>{if(!ok)throw Error(message)};
  const source=[{Text:'سلام'.repeat(8),StartTime:1,EndTime:2,IsPartOfWord:true},{Text:'سلام'.repeat(8),StartTime:4,EndTime:7,IsPartOfWord:false}];
  const doc=NormalizeLyrics({Type:'Syllable',Source:{HasWordSync:true},StartTime:1,EndTime:7,Content:[{Type:'Vocal',Lead:{StartTime:1,EndTime:7,Syllables:source}}]});
  const voice=doc.groups[0].voices[0],base=LayoutVoice(voice),owned=[];
  try{
   check(base.length===1&&base[0].Intervals.length===2,'real joining-script canonical owner spans two source intervals with genuine gap');
   for(const mode of ['Original','Replace','Above','Ruby'])for(const minimal of [false,true]){
    const root=document.createElement('div');root.className='Lyrics NaturallyAlignedLeft';document.body.append(root);const group=document.createElement('button');group.className='VocalsGroup';root.append(group);
    const profile=minimal?ApplyTextPreset({...ClassicRendering},'minimal'):{...ClassicRendering,blur:false},v=new VocalController(group,doc,voice,profile);owned.push(v);
    ApplyLayoutStyle(root,{...ClassicLayout},'sans-serif');v.PrepareSourceWrapping()?.();
    const originalRange=document.createRange();originalRange.selectNodeContents(v.root.querySelector('.SourcePaint'));
    const originalFirstTop=Math.min(...[...originalRange.getClientRects()].map(rect=>rect.top))-group.getBoundingClientRect().top;
    const readings=base.map(run=>({...run,AnnotationDerived:true,Text:mode==='Replace'?'reading'.repeat(18):run.Text,Readings:[{text:'よみ',start:24,end:25}],Reading:{text:'よみ',start:24,end:25}}));
    if(mode==='Replace')v.SetProjection(readings,0);
    if(mode==='Above')v.SetAnnotations(NormalizeAnnotations(),readings,undefined,0);
    if(mode==='Ruby')v.SetAnnotations(NormalizeAnnotations(),undefined,readings,0);
    ApplyLayoutStyle(root,{...ClassicLayout},'sans-serif');v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
    const sourceRoot=v.root,owner=v.child,syllable=sourceRoot.querySelector('.Syllable'),node=syllable.querySelector('.SourcePaint');
    check(syllable.offsetHeight>parseFloat(getComputedStyle(sourceRoot).lineHeight)*2,mode+' actually wraps multiple rows');
    check(sourceRoot.scrollWidth<=sourceRoot.clientWidth+2,mode+' available column width');
    const range=document.createRange();range.selectNodeContents(node);check(range.getClientRects().length>=3,mode+' preserves text-flow rows');
    if(mode==='Ruby') {
      const entry=v.ruby.entries[0],anchor=entry.pieces[0].range().getBoundingClientRect(),reading=entry.host.getBoundingClientRect();
      const glyphs=[];for(let index=0;index<node.firstChild.length;index++){const r=document.createRange();r.setStart(node.firstChild,index);r.setEnd(node.firstChild,index+1);glyphs.push(r.getBoundingClientRect())}
      const previous=glyphs.filter(rect=>rect.top<anchor.top-2);
      check(previous.length&&Math.max(...previous.map(rect=>rect.bottom))<=reading.top+2,'wrapped internal ruby row clears preceding source row '+JSON.stringify({anchor:anchor.toJSON(),reading:reading.toJSON(),previousBottom:Math.max(...previous.map(rect=>rect.bottom))}));
      check(!syllable.style.marginBlockStart&&!syllable.closest('.Word')?.style.marginBlockStart,'internal-only reading does not charge unannotated first row Word margin');
      const firstTop=Math.min(...glyphs.map(rect=>rect.top))-group.getBoundingClientRect().top;
      check(Math.abs(firstTop-originalFirstTop)<1,'unannotated first wrapped row keeps Original top/leading '+JSON.stringify({firstTop,originalFirstTop}));
      // A previous row exclusion must not masquerade as source wrapping after
      // a real width/font change. Use the production read/write ordering once.
      root.style.width='4000px';
      const wideRects=[...node.getClientRects()];check(wideRects.length&&Math.max(...wideRects.map(rect=>rect.top))-Math.min(...wideRects.map(rect=>rect.top))<1,'wide source actually occupies one text row before classification');
      v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
      check(!syllable.classList.contains('WrappedPainter'),'widening returns single-row source to Classic painter in one batch');
      check(!sourceRoot.querySelector('.RubyLineSpacer:not([hidden])'),'widening removes interior row exclusion');
      root.style.width='220px';v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
      check(syllable.classList.contains('WrappedPainter'),'narrowing restores actual wrapped painter');
      root.style.width='900px';ApplyLayoutStyle(root,{...ClassicLayout,primaryRatio:2},'sans-serif');v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
      ApplyLayoutStyle(root,{...ClassicLayout,primaryRatio:.5},'sans-serif');v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
      check(!syllable.classList.contains('WrappedPainter'),'font shrinking returns actual single-row source to Classic painter');
      root.style.width='220px';ApplyLayoutStyle(root,{...ClassicLayout},'sans-serif');v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
    }
    let phase;
    for(const time of [0,1.5,2.1,3.5,4.5,8,0,4.5]) {
     v.Animate(time,1/60,true);
     const next=syllable.style.getPropertyValue('--gradient-progress');
     if(time===2.1)phase=next;if(time===3.5)check(next===phase,mode+' genuine silent gap freezes source paint');
     check(sourceRoot===v.root&&owner===v.child&&syllable===sourceRoot.querySelector('.Syllable'),mode+' seeks keep canonical paint owner');
    }
    v.Animate(4.6,1/60);v.Animate(4.7,1/60);const springs=owner.Syllables[0].LiveText.Springs,before=springs&&Object.values(springs).filter(Boolean).map(s=>[s,s.Position,s.Velocity]);
    ApplyLayoutStyle(root,{...ClassicLayout,leading:2.5,primaryRatio:1.2},'monospace');v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
    check(root.classList.contains('CustomFontFamily'),'explicit family enables scoped family selector');
    if(before)check(before.every(([spring,position,velocity])=>spring.Position===position&&spring.Velocity===velocity),mode+' typography preserves numeric moving springs');
    check([...group.querySelectorAll('.Vocals,.SourcePaint,.Letter')].every(element=>getComputedStyle(element).fontFamily==='monospace'),mode+' explicit family beats actual theme descendant important rule');
    check(Math.abs(parseFloat(getComputedStyle(sourceRoot).lineHeight)/parseFloat(getComputedStyle(sourceRoot).fontSize)-2.5)<.01,mode+' independent source leading');
    const above=group.querySelector('.SecondaryText'),ruby=group.querySelector('.RubyReading');
    if(above)check(Math.abs(parseFloat(getComputedStyle(above).lineHeight)/parseFloat(getComputedStyle(above).fontSize)-1.1818181818)<.01,'Above keeps original independent leading');
    if(ruby)check(Math.abs(parseFloat(getComputedStyle(ruby).lineHeight)/parseFloat(getComputedStyle(ruby).fontSize)-1.1)<.01,'ruby keeps independent leading');
    ApplyLayoutStyle(root,{...ClassicLayout},'');check([...group.querySelectorAll('.Vocals,.SourcePaint,.Letter')].every(element=>getComputedStyle(element).fontFamily==='serif'),mode+' blank restores actual direct theme font');
    check(!root.classList.contains('CustomFontFamily')&&!root.style.getPropertyValue('--jel-family'),'blank clears family selector and custom property');
    if(mode==='Ruby') {
      v.SetAnnotations(NormalizeAnnotations(),undefined,undefined,4.7);root.style.width='4000px';v.PrepareSourceWrapping()?.();v.MeasureAnnotations();
      check(!root.querySelector('.RubyLineSpacer,.RubyAnnotation')&&!syllable.classList.contains('WrappedPainter'),'readings Off releases exclusion and widening restores normal painter');
      check(sourceRoot===v.root&&owner===v.child&&node===sourceRoot.querySelector('.SourcePaint'),'readings Off preserves canonical source and painter nodes');
    }
    v.Destroy();root.remove();
   }
   jelTestComplete('WRAPPED_ANNOTATIONS_PASS');
  }catch(error){jelTestComplete('WRAPPED_ANNOTATIONS_FAIL: '+error.stack)}finally{owned.forEach(v=>v.Destroy())}
 })();`;
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-wrap-annotations-')));
 try{const file=path.join(directory,'fixture.html');await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>${css}:root *{font-family:serif!important}.Lyrics{width:220px;height:1800px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.Vocals{transition:none!important}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'WRAPPED_ANNOTATIONS_PASS');}
 finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-wrap-annotations-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
