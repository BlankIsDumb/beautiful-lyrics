import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('ruby reserves only actual annotated visual rows against untouched Original density and cleans reusable layout state', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture();
  const script=`(()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,LayoutVoice,ClassicRendering,RunAnnotationLayout}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const profile={...ClassicRendering,detail:'line',highlight:'segment',scale:false,glow:false,blur:false};
    const settings=NormalizeAnnotations(),font='Nunito,"Zen Kaku Gothic Antique Medium",SOV_monomon,sans-serif';
    function rows(line){
      // Test-only grapheme ranges establish an independent visible-row oracle.
      // Production uses its existing whole-source Range and annotation ranges.
      const result=[],walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let node,offset=0;
      while(node=walker.nextNode()){
        if(node.nodeType===Node.ELEMENT_NODE&&node.tagName==='BR'){offset++;continue;}
        if(node.nodeType!==Node.TEXT_NODE)continue;
        for(const part of new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(node.textContent)){
          const range=document.createRange();range.setStart(node,part.index);range.setEnd(node,part.index+part.segment.length);
          const rect=range.getBoundingClientRect();if(!rect.width)continue;
          let row=result.find(row=>Math.abs(row.top-rect.top)<.1);if(!row){row={top:rect.top,bottom:rect.bottom,parts:[]};result.push(row)}
          row.parts.push({text:part.segment,start:offset+part.index,end:offset+part.index+part.segment.length});
        }offset+=node.textContent.length;
      }return result.sort((a,b)=>a.top-b.top);
    }
    function mount(text,mode='Line',size=29.6,width=337.034,direction='Left',opposite=false){
      const shell=document.createElement('div');shell.className='shell';shell.style.cssText='width:'+width+'px;--encore-body-font-stack:'+font;document.body.append(shell);
      const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAligned'+direction;lyrics.style.setProperty('--minimum-lyrics-size',size+'px');lyrics.style.setProperty('--maximum-lyrics-size',size+'px');shell.append(lyrics);
      const group=document.createElement('button');group.className='VocalsGroup'+(opposite?' AlignedOpposite':'');lyrics.append(group);
      const doc=mode==='Static'?NormalizeLyrics({Type:'Static',Lines:[{Text:text}]}):mode==='Line'?NormalizeLyrics({Type:'Line',StartTime:1,EndTime:9,Content:[{Type:'Vocal',Text:text,StartTime:1,EndTime:9}]}):NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:9,Source:{HasWordSync:true},Content:[{Type:'Vocal',Lead:{StartTime:1,EndTime:9,Syllables:[{Text:text.slice(0,3),StartTime:1,EndTime:4,IsPartOfWord:true},{Text:text.slice(3),StartTime:5,EndTime:9,IsPartOfWord:false}]}}]});
      const voice=doc.groups[0].voices[0],controller=new VocalController(group,doc,voice,{...profile}),line=controller.root.querySelector('.Line,.Static');
      check(Math.abs(parseFloat(getComputedStyle(controller.root).fontSize)-size)<.01,'fixture actual source size '+size);
      return {shell,lyrics,group,doc,voice,controller,line,destroy(){controller.Destroy();shell.remove()}};
    }
    const mapped=(item,readings)=>LayoutVoice(item.voice).map((run,index)=>index?run:{...run,AnnotationDerived:true,Readings:readings,Reading:readings[0]});
    const textOf=rows=>rows.map(row=>row.parts.map(part=>part.text).join(''));
    let cases=0;const thresholds=[];
    try{
      for(const [size,width] of [[29.6,337.034],[18,212],[42,337.034],[56,632],[29.6,343.4],[29.6,343.7]])for(const mode of ['Line','forcedLine','Static'])for(const [direction,opposite] of [['Left',false],['Right',false],['Left',true],['Right',true]])for(const pattern of ['first','interior','sparse','dense','BR','blankBR']){
        const text=pattern==='first'?'狂おしいほど救われていたんだ':pattern==='BR'||pattern==='blankBR'?'明日世界未来心空光夢星雨風'+String.fromCharCode(10).repeat(pattern==='blankBR'?2:1)+'明日世界未来心空光夢星雨風'+String.fromCharCode(10)+'明日世界未来心空光夢星雨風':'明日世界未来心空光夢星雨風'.repeat(4);
        const reference=mount(text,mode,size,width,direction,opposite),candidate=mount(text,mode,size,width,direction,opposite),label=[size,width,mode,direction,opposite,pattern].join('/');
        try{
          const before=rows(reference.line),sourceNodes=[...candidate.line.childNodes],owner=candidate.controller.child;
          const wanted=pattern==='first'?[0]:pattern==='interior'?[1]:pattern==='sparse'?[1,3]:pattern==='dense'?before.map((_,index)=>index):[0,2];
          const readings=pattern==='first'?[{text:'くる',start:0,end:1},{text:'すく',start:text.indexOf('救'),end:text.indexOf('救')+1}]:wanted.filter(index=>before[index]).map(index=>{const part=before[index].parts[0];return {text:'よみ',start:part.start,end:part.end}});
          candidate.controller.SetAnnotations(settings,undefined,mapped(candidate,readings),0);candidate.controller.MeasureAnnotations();
          const after=rows(candidate.line),layer=candidate.controller.ruby;
          check(JSON.stringify(textOf(before))===JSON.stringify(textOf(after)),label+' unchanged Original wrap/text');
          check(sourceNodes.every(node=>node.parentNode===candidate.line)&&candidate.controller.child===owner,label+' exact source nodes and one canonical paint owner');
          check(!candidate.line.style.lineHeight&&getComputedStyle(candidate.line).lineHeight===getComputedStyle(reference.line).lineHeight,label+' never changes blanket leading');
          let bands=0;
          for(let index=1;index<before.length;index++){
            const matching=layer.entries.filter(entry=>before[index].parts.some(part=>part.start===entry.start));
            const gap=Math.max(1,size*.04),free=Math.max(0,before[index].top-before[index-1].bottom);
            const need=matching.length?Math.max(0,Math.max(...matching.map(entry=>entry.metrics.height*Number(entry.root.style.getPropertyValue('--ruby-fit'))+gap+2))-free):0;
            const original=before[index].top-before[index-1].top,actual=after[index].top-after[index-1].top;
            if(need>.05){bands++;check(actual-original>=need-.15&&actual-original<need+3.2,label+' only actual annotated row receives fitted clearance '+JSON.stringify({index,need,original,actual}));}
            else check(Math.abs(actual-original)<.1,label+' unannotated/already-clear row keeps Original step '+JSON.stringify({index,original,actual}));
          }
          check(candidate.line.querySelectorAll('.RubyLineSpacer').length===(bands?1:0),label+' one reusable empty exclusion, no per-row owners');
          if(width>343&&size===29.6&&mode==='Line'&&direction==='Left'&&!opposite&&pattern==='dense')thresholds.push(before[0].parts.length);
          candidate.controller.SetAnnotations(NormalizeAnnotations(),undefined,undefined,0);
          check(!candidate.line.querySelector('.RubyLineSpacer')&&!candidate.line.classList.contains('RubyLineLayout'),label+' Off removes source layout state');
          const restored=rows(candidate.line);check(restored.length===before.length&&restored.every((row,index)=>Math.abs((row.top-restored[0].top)-(before[index].top-before[0].top))<.1),label+' Off restores true Original density');
          cases++;
        }finally{reference.destroy();candidate.destroy();}
      }
      check(cases===432&&thresholds[0]!==thresholds[1],'matrix crosses actual wrapping threshold');
      const fractional=mount('明日世界未来心空光夢星雨風'.repeat(4),'Line',29.6,343.4);
      try{
        const readings=[...fractional.voice.spans[0].Text].map((_,index)=>({text:'よみ',start:index,end:index+1})),v=fractional.controller;
        v.SetAnnotations(settings,undefined,mapped(fractional,readings),0);v.MeasureAnnotations();
        const width=v.ruby.Element.clientWidth,key=v.ruby.fitKey,anchor=v.ruby.entries.find(entry=>entry.start===9),position=anchor.host.style.translate,spacer=v.ruby.lineSpacer;
        fractional.shell.style.width='343.7px';check(v.ruby.Element.clientWidth===width,'exercise changed wrap within same integer width');v.MeasureAnnotations();
        check(v.ruby.fitKey!==key&&anchor.host.style.translate!==position&&v.ruby.lineSpacer===spacer,'fractional resize repositions reading across wrap while reusing spacer');
      }finally{fractional.destroy()}
      // Lifecycle uses the real moving primary spring, not identity alone.
      const item=mount('明日世界未来心空光夢星雨風'.repeat(4)),v=item.controller;
      try{
        v.SetRendering({...profile,glow:true},0);v.Animate(1.7,1/60);v.Animate(2.1,1/60);
        const sourceNodes=[...item.line.childNodes],owner=v.child,spring=owner.GlowSpring,position=spring.Position,velocity=spring.Velocity;
        check(Math.abs(velocity)>1e-6,'warm actual spring');
        const readings=[...item.voice.spans[0].Text].map((_,index)=>({text:'よみ',start:index,end:index+1})),runs=mapped(item,readings);
        v.SetAnnotations(settings,undefined,runs,2.1);v.MeasureAnnotations();const first=v.ruby.lineSpacer;
        check(first&&v.child===owner&&owner.GlowSpring===spring&&spring.Position===position&&spring.Velocity===velocity&&sourceNodes.every(node=>node.parentNode===item.line),'layout preserves exact moving primary and text nodes');
        item.shell.style.width='320px';v.MeasureAnnotations();check(v.ruby.lineSpacer===first,'width change reuses one empty spacer');
        item.lyrics.style.setProperty('--minimum-lyrics-size','42px');item.lyrics.style.setProperty('--maximum-lyrics-size','42px');v.MeasureAnnotations(1);check(v.ruby.lineSpacer===first,'font invalidation reuses spacer');
        v.SetRendering({...profile,glow:true,emphasis:false},2.1);check(!first.isConnected,'source layout invalidation releases old spacer');v.MeasureAnnotations(1);check(v.ruby.lineSpacer?.isConnected,'profile reconciliation rebuilds only needed layout state');
        const replaced=v.ruby.lineSpacer;v.SetProjection([{...runs[0],Text:'unmapped'}],2.1);v.MeasureAnnotations(2);
        check(!replaced.isConnected&&!item.line.querySelector('.RubyLineSpacer')&&!item.line.classList.contains('RubyLineLayout')&&v.ruby.Element.classList.contains('RubyNoReadings')&&parseFloat(getComputedStyle(v.ruby.Element).paddingTop)===0,'unmappable replacement keeps Original with no band/spacer');
        v.SetProjection(LayoutVoice(item.voice),2.1);v.MeasureAnnotations(3);check(v.ruby.lineSpacer?.isConnected,'real source replacement recovers source mapping');
        v.ruby.InvalidateLayout();const rects=Range.prototype.getClientRects;Range.prototype.getClientRects=function(){return this.startContainer===item.line&&this.endContainer===item.line?[]:rects.call(this)};
        try{v.MeasureAnnotations(3)}finally{Range.prototype.getClientRects=rects}
        check(!item.line.style.marginBlockStart&&!item.line.querySelector('.RubyLineSpacer')&&v.ruby.entries.every(entry=>entry.host.hidden),'missing whole-Line geometry safely omits readings instead of Word margins');
        v.ruby.InvalidateLayout();v.MeasureAnnotations(3);
        v.ruby.InvalidateLayout();const job=v.PrepareAnnotations(3);const warn=console.warn;console.warn=()=>{};try{RunAnnotationLayout([{...job,locate(){throw Error('intentional layout failure')}}])}finally{console.warn=warn}
        check(!item.line.querySelector('.RubyLineSpacer')&&!item.line.classList.contains('RubyLineLayout')&&parseFloat(getComputedStyle(v.ruby.Element).paddingTop)===0,'failed job clears all source layout state');
        check(!v.PrepareAnnotations(3),'failed layout is cached until real invalidation');v.ruby.InvalidateLayout();v.MeasureAnnotations(4);const disposed=v.ruby.lineSpacer;
        v.Destroy();check(!disposed?.isConnected&&!item.line.querySelector('.RubyLineSpacer')&&!item.line.classList.contains('RubyLineLayout'),'disposal releases spacer even when source is retained by test');
      }finally{item.destroy()}
      jelTestComplete('RUBY_ROWS_PASS');
    }catch(error){jelTestComplete('RUBY_ROWS_FAIL: '+error.stack)}
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-ruby-rows-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}body{margin:0}.shell{position:absolute;left:20px;top:40px;padding:16px;container-type:inline-size}.Lyrics{width:100%;height:2000px}.Vocals,.Line{transition:none!important}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'RUBY_ROWS_PASS');
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-ruby-rows-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
