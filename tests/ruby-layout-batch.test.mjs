import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('annotation layout crosses whole-song barriers and cleans a failed job exactly once',async()=>{
  const result=await build({entryPoints:['Extension/Source/Modules/LyricsRenderer/AnnotationLayout.ts'],bundle:true,write:false,format:'esm'});
  const {RunAnnotationLayout}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const events=[],phases=['prepare','measure','reserve','locate','commit'];
  const jobs=[0,1,2].map(index=>Object.fromEntries([...phases,'cleanup'].map(phase=>[phase,()=>{events.push(phase+index);if(index===1&&phase==='measure')throw Error('intentional mapped layout failure')}])));
  const warn=console.warn;console.warn=()=>{};try{RunAnnotationLayout(jobs)}finally{console.warn=warn}
  assert.deepEqual(events,['prepare0','prepare1','prepare2','measure0','measure1','cleanup1','measure2','reserve0','reserve2','locate0','locate2','commit0','commit2','cleanup0','cleanup2']);
});

test('80-voice changing-width layout batches stay bounded, reuse metrics, and reserve compact glyph clearance', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture();
  const script=`(async()=>{${code}
  const {VocalController,NormalizeLyrics,AlignJapanese,NormalizeAnnotations,ClassicRendering,ApplyTextPreset,RunAnnotationLayout}=fixtureModule;
  const check=(ok,message)=>{if(!ok)throw Error(message)},minimal=ApplyTextPreset({...ClassicRendering},'minimal');
  const shell=document.createElement('div');shell.style.cssText='container-type:inline-size;width:340px';document.body.append(shell);
  const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAlignedLeft';lyrics.style.cssText='--minimum-lyrics-size:32px;--maximum-lyrics-size:32px';shell.append(lyrics);
  const tokens=[['胸','ムネ'],['を'],['焦','コ'],['がして'],['君','キミ'],['の'],['夜','ヨル'],['を'],['彩','イロドリ'],['る']];
  const part={StartTime:1,EndTime:8,Syllables:tokens.map(([Text],index)=>({Text,StartTime:1+index*.5,EndTime:2+index*.5,IsPartOfWord:false}))};
  const doc=NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:8,Source:{HasWordSync:true},Content:[{Type:'Vocal',Lead:part}]}),voice=doc.groups[0].voices[0];
  const runs=AlignJapanese(voice,tokens.map(([surface_form,reading])=>({surface_form,reading})),'kana',text=>text.replace(/[ァ-ヶ]/gu,char=>String.fromCharCode(char.charCodeAt(0)-96)));
  const controllers=[],groups=[];
  for(let index=0;index<80;index++){
    const group=document.createElement('button');group.className='VocalsGroup';lyrics.append(group);groups.push(group);
    const controller=new VocalController(group,doc,voice,minimal);controllers.push(controller);controller.SetAnnotations(NormalizeAnnotations(),undefined,runs,0);
  }
  await document.fonts.ready;
  const verifyAnchors=()=>{
    const layer=controllers[0].ruby;if(!layer)return;const frame=layer.sourceFrame(),owner=layer.Element.getBoundingClientRect();
    for(const entry of layer.entries.filter(entry=>!entry.host.hidden)){
      const rects=entry.pieces.flatMap(piece=>[...piece.range().getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>frame(rect,piece.parent)));
      const expected=Math.min(...rects.map(rect=>rect.top))-owner.top-entry.metrics.height*Number(entry.root.style.getPropertyValue('--ruby-fit'))-1.28;
      check(Math.abs(parseFloat(entry.host.style.translate.split(' ')[1])-expected)<.12,'multi-item reading position matches real post-reserve source glyphs');
    }
  };
  const batch=(width,font=0)=>{shell.style.width=width+'px';RunAnnotationLayout(controllers.map(controller=>controller.PrepareAnnotations(font)).filter(Boolean));const heights=groups.map(group=>group.offsetHeight);verifyAnchors();return heights};
  batch(340);batch(360);batch(340);
  let clones=0,readingWidths=0;
  const clone=Node.prototype.cloneNode,descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollWidth');
  Node.prototype.cloneNode=function(...args){clones++;return clone.apply(this,args)};
  Object.defineProperty(Element.prototype,'scrollWidth',{...descriptor,get(){if(this.classList.contains('RubyReading'))readingWidths++;return descriptor.get.call(this)}});
  globalThis.resizeFixture={
    batch(width){batch(width);return {clones,readingWidths}},
    finish(){
      check(clones===0&&readingWidths===0,'width-only batches reuse mapped source and reading metrics without clones');
      batch(340,1);check(readingWidths===400,'one font generation remeasures each reading once');
      const count=readingWidths;batch(340,1);check(readingWidths===count,'same font/width does zero metric work');
      for(const controller of controllers)controller.SetAnnotations(NormalizeAnnotations(),undefined,undefined,0);
      batch(320,2);check(readingWidths===count,'Off releases all source/metric work');
      controllers.forEach(controller=>controller.Destroy());Node.prototype.cloneNode=clone;Object.defineProperty(Element.prototype,'scrollWidth',descriptor);
      // A single-row Line must not pay both top clearance and added leading.
      for(const detail of ['auto','line']){
        shell.style.width='700px';const group=document.createElement('button');group.className='VocalsGroup';lyrics.append(group);
        const tinyPart={StartTime:1,EndTime:4,Syllables:[{Text:'胸を',StartTime:1,EndTime:4,IsPartOfWord:false}]};
        const tinyDoc=NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:4,Source:{HasWordSync:true},Content:[{Type:'Vocal',Lead:tinyPart}]}),tinyVoice=tinyDoc.groups[0].voices[0];
        const controller=new VocalController(group,tinyDoc,tinyVoice,{...minimal,detail}),source=group.firstElementChild;
        const height=source.getBoundingClientRect().height,leading=source.querySelector('.Line')&&getComputedStyle(source.querySelector('.Line')).lineHeight;
        const mapped=AlignJapanese(tinyVoice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'を'}],'kana',()=> 'むね');
        controller.SetAnnotations(NormalizeAnnotations(),undefined,mapped,0);controller.MeasureAnnotations();
        const owner=group.querySelector('.RubyVocals'),reading=owner.querySelector('.RubyReading');
        check(owner.getBoundingClientRect().height<=height+reading.offsetHeight*1.1+5,'single-row compact clearance stays within actual reading height plus small motion gap');
        check(owner.getBoundingClientRect().height<65,'32px single row stays below the old excessive .18 band');
        if(leading)check(getComputedStyle(source.querySelector('.Line')).lineHeight===leading,'single-row Line keeps Original leading');
        controller.Destroy();group.remove();
      }
      jelTestComplete('RUBY_BATCH_PASS');
    }
  };
  })().catch(error=>{globalThis.resizeError=String(error.stack);jelTestComplete(globalThis.resizeError)});`;
  const directory=await mkdtemp(path.join(tmpdir(),'jel-ruby-batch-'));
  try{
    const file=path.join(directory,'fixture.html');await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'),async command=>{
      const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value};
      await evaluate('new Promise((resolve,reject)=>{function ready(){if(globalThis.resizeError)return reject(Error(globalThis.resizeError));if(globalThis.resizeFixture)return resolve();requestAnimationFrame(ready)}ready()})');
      await command('Performance.enable');
      const metric=async()=>Object.fromEntries((await command('Performance.getMetrics')).metrics.map(({name,value})=>[name,value]));
      const before=await metric();
      for(const width of [380,320,400,340,360])assert.deepEqual(await evaluate('resizeFixture.batch('+width+')'),{clones:0,readingWidths:0});
      const after=await metric();assert.ok(after.LayoutCount-before.LayoutCount<=20,'layout count is bounded by phase count, not 400 readings');
      await evaluate('resizeFixture.finish()');
    });
    assert.equal(result,'RUBY_BATCH_PASS');
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
