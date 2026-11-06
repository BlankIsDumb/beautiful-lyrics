import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildVocalFixture } from './renderer-fixture.mjs';
import { runFocusedFixture } from './chromium-focus-harness.mjs';
const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

test('ruby keeps canonical primary paint/springs/emphasis and uses bounded source-spacing-preserving overhang', {skip:!chrome},async()=>{
  const {code,css}=await buildVocalFixture();
  const script=`(()=>{${code}
    const {VocalController,NormalizeLyrics,NormalizeAnnotations,AlignJapanese,ClassicRendering,ApplyTextPreset,CreateRenderingCounters}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)},owned=[];
    const kana=text=>text.replace(/[ァ-ヶ]/gu,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
    const minimal=ApplyTextPreset({...ClassicRendering},'minimal');
    const settings=NormalizeAnnotations({opacity:.8});for(const sourceCase of ['Word','Line'])settings.cases[sourceCase]={inherit:false,effects:minimal};
    const parts=(texts)=>({StartTime:1,EndTime:8,Syllables:texts.map(([Text,StartTime,EndTime,IsPartOfWord=true])=>({Text,StartTime,EndTime,IsPartOfWord}))});
    const makeDoc=(texts,line=false)=>{const part=parts(texts);return NormalizeLyrics({Type:'Syllable',StartTime:1,EndTime:8,Source:{HasWordSync:!line},Content:[{Type:'Vocal',Lead:part,Background:[part]}]})};
    const hosts=[0,1].map(index=>{const host=document.createElement('div');host.className='shell Lyrics NaturallyAlignedLeft';host.style.cssText='position:absolute;left:20px;top:100px;width:700px;height:900px';document.body.append(host);return host});
    let pair;
    const clear=()=>{owned.splice(0).forEach(object=>object.Destroy());hosts.forEach(host=>host.replaceChildren())};
    const setup=(detail,emphasis=true)=>{
      clear();const doc=makeDoc([['て胸を',1,4],['焦がしてしまう',4,8]],detail==='trueLine');
      const profile={...ClassicRendering,detail:detail==='forcedLine'?'line':'auto',emphasis,blur:false};
      const groups=hosts.map(host=>{const group=document.createElement('button');group.className='VocalsGroup';host.append(group);return group});
      const counts=[CreateRenderingCounters(),CreateRenderingCounters()];
      const controllers=groups.map((group,index)=>{const controller=new VocalController(group,doc,doc.groups[0].voices[0],profile,counts[index]);owned.push(controller);return controller});
      const roots=groups.map(group=>group.firstElementChild);
      const tokens=[{surface_form:'て',reading:'テ'},{surface_form:'胸',reading:'ムネ'},{surface_form:'を',reading:'ヲ'},{surface_form:'焦がし',reading:'コガシ'},{surface_form:'て',reading:'テ'},{surface_form:'しまう',reading:'シマウ'}];
      const runs=AlignJapanese(doc.groups[0].voices[0],tokens,'kana',kana);
      // Start a real non-immediate spring trajectory before async ruby arrival.
      for(const time of [1.01,1.1,1.3,1.6,1.9])controllers.forEach(controller=>controller.Animate(time,1/60));
      const before=[...roots[1].querySelectorAll('.Synced')],state=before.map(node=>node.getAttribute('style'));
      controllers[1].SetAnnotations(settings,undefined,runs,1.9);
      check(before.every((node,index)=>node===roots[1].querySelectorAll('.Synced')[index]&&node.getAttribute('style')===state[index]),'async arrival preserves primary DOM and spring values');
      controllers[1].MeasureAnnotations();
      check(roots[0].querySelectorAll('.Syllable').length===roots[1].querySelectorAll('.Syllable').length,'one canonical run owner, no annotation-boundary primary clones');
      check(roots[0].querySelectorAll('.Emphasis').length===roots[1].querySelectorAll('.Emphasis').length&&roots[0].querySelectorAll('.Letter').length===roots[1].querySelectorAll('.Letter').length,'primary emphasis ownership/index count retained');
      check(counts[0].springsAllocated===counts[1].springsAllocated,'all-Off reading allocates no extra springs');
      pair={doc,controllers,roots,runs,profile,counts,detail};
    };
    const primaryParity=()=>{
      const [a,b]=pair.roots.map(root=>[...root.querySelectorAll('.Synced')]);
      check(a.length===b.length&&a.every((node,index)=>node.textContent===b[index].textContent&&['scale','transform','--gradient-progress','--text-shadow-blur-radius','--text-shadow-opacity'].every(property=>node.style.getPropertyValue(property)===b[index].style.getPropertyValue(property))),'canonical primary visible effect values/emphasis indices stay equal '+JSON.stringify(a.map((node,index)=>[node.textContent,node.getAttribute('style'),b[index]?.getAttribute('style')])));
      check(pair.counts[0].springUpdates===pair.counts[1].springUpdates,'reading layer adds no primary spring updates');
    };
    const show=index=>{
      hosts.forEach((host,i)=>{host.style.display=i===index?'block':'none';host.style.top='100px'});
      const root=pair.roots[index],rect=root.getBoundingClientRect();
      hosts[index].style.top=(100+100-rect.top)+'px';
      const bounds=root.getBoundingClientRect();return {x:bounds.left,y:bounds.top,width:bounds.width,height:bounds.height,scale:1};
    };
    globalThis.rubyFixture={setup,step(time,immediate=false){pair.controllers.forEach(controller=>controller.Animate(time,1/60,immediate||undefined));primaryParity()},paint(index){
      // A canonical Line's necessary reading leading is typography. Give the
      // reference that same box geometry, then compare actual source paint pixels.
      hosts[1].style.display='block';const source=pair.roots[1],reference=pair.roots[0];
      reference.style.rowGap=getComputedStyle(source).rowGap;reference.style.alignItems=getComputedStyle(source).alignItems;
      [...reference.children].forEach((child,index)=>child.style.marginBlockStart=source.children[index].style.marginBlockStart);
      if(source.querySelector('.Line'))reference.querySelector('.Line').style.lineHeight=getComputedStyle(source.querySelector('.Line')).lineHeight;
      return show(index);
    },toggle(){
      const primary=pair.roots[1],nodes=[...primary.querySelectorAll('.Synced')],styles=nodes.map(node=>node.getAttribute('style'));
      pair.controllers[1].SetAnnotations(NormalizeAnnotations(),undefined,undefined,2.2);
      check(primary.parentElement===hosts[1].firstElementChild,'Off unwraps exact primary root');
      pair.controllers[1].SetAnnotations(settings,undefined,pair.runs,2.2);pair.controllers[1].MeasureAnnotations();
      check(nodes.every((node,index)=>node===primary.querySelectorAll('.Synced')[index]&&node.getAttribute('style')===styles[index]),'Off/On keeps primary values and DOM without a clock snap');primaryParity();
    },geometry(){
      document.body.classList.remove("PaintOnly");
      clear();hosts.forEach(host=>{host.style.display='block';host.style.top='100px';host.style.width='700px'});
      const doc=makeDoc([['どんな',1,2],['時の彩を',2,4]]),voice=doc.groups[0].voices[0];
      const groups=hosts.map(host=>{const group=document.createElement('button');group.className='VocalsGroup';host.append(group);return group});
      const controllers=groups.map(group=>{const controller=new VocalController(group,doc,voice,minimal);owned.push(controller);return controller});
      const roots=groups.map(group=>group.firstElementChild),runs=AlignJapanese(voice,[{surface_form:'どんな',reading:'ドンナ'},{surface_form:'時',reading:'トキ'},{surface_form:'の',reading:'ノ'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'を',reading:'ヲ'}],'kana',kana);
      controllers[1].SetAnnotations(settings,undefined,runs,0);controllers[1].MeasureAnnotations();
      let owner=groups[1].querySelector('.RubyVocals');
      const glyphs=root=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),rects=[];let node;while(node=walker.nextNode())for(let i=0;i<node.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);rects.push(range.getBoundingClientRect())}return rects};
      const a=glyphs(roots[0]),b=glyphs(roots[1]),leftA=roots[0].getBoundingClientRect().left,leftB=roots[1].getBoundingClientRect().left;
      check(a.length===b.length&&a.every((rect,index)=>Math.abs((rect.left-leftA)-(b[index].left-leftB))<.01),'reading overhang preserves every original horizontal source glyph position');
      const color=[...owner.querySelectorAll('.RubyReading')].find(node=>node.textContent==='いろどり');
      check(color&&Number(color.style.getPropertyValue('--ruby-fit'))===1&&color.getBoundingClientRect().width>b[5].width*1.5,'wide reading freely overhangs one-kanji anchor without source widening/fit');
      let clones=0,reads=0;const clone=roots[1].cloneNode.bind(roots[1]);roots[1].cloneNode=(...args)=>{clones++;return clone(...args)};
      for(const reading of owner.querySelectorAll('.RubyReading')){
        const measure=reading.getBoundingClientRect.bind(reading);
        reading.getBoundingClientRect=()=>{reads++;return measure()};
      }
      controllers[1].MeasureAnnotations();controllers[1].MeasureAnnotations();for(let i=0;i<100;i++)controllers[1].Animate((i%7)+.1,1/60,true);
      check(clones===0&&reads===0&&!owner.querySelector('.RubyMeasure'),'cached layout and playback do zero clone/reading-width work');
      const verify=()=>{const bounds=owner.getBoundingClientRect(),readings=[...owner.querySelectorAll('.RubyAnnotation:not([hidden])')].map(node=>node.getBoundingClientRect());
        check(readings.length>0,'safe readings remain visible');for(const rect of readings)check(rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1,'readings fit real combined voice/viewport bounds');
        for(let i=0;i<readings.length;i++)for(let j=i+1;j<readings.length;j++){const a=readings[i],b=readings[j];check(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'reading strings never collide');}
      };
      for(const width of [180,700])for(const alignment of ['inherit','start','center','end']){
        hosts[1].style.width=width+'px';controllers[1].SetAnnotations({...settings,rubySize:1,spacing:.1,alignment},undefined,runs,0);controllers[1].MeasureAnnotations();verify();
      }
      const long=runs.map(run=>run.Reading?{...run,Readings:run.Readings.map(reading=>({...reading,text:'いろどり'.repeat(30)}))}:run);
      controllers[1].SetAnnotations({...settings,rubySize:1},undefined,long,0);controllers[1].MeasureAnnotations();owner=groups[1].querySelector('.RubyVocals');verify();
      check([...owner.querySelectorAll('.RubyReading')].some(reading=>Number(reading.style.getPropertyValue('--ruby-fit'))<1),'real crowding/overflow receives bounded uniform fit');
      const before=clones;hosts[1].style.setProperty('--minimum-lyrics-size','40px');hosts[1].style.setProperty('--maximum-lyrics-size','40px');controllers[1].MeasureAnnotations(1);check(clones===before,'font generation/size reuses cached source DOM mapping');verify();
      controllers[1].SetAnnotations(NormalizeAnnotations(),undefined,undefined,0);const after=clones;controllers[1].MeasureAnnotations(2);check(clones===after&&!groups[1].querySelector('.RubyAnnotation'),'Off removes reading layout work');
    },hardCases(){
      clear();hosts.forEach(host=>{host.style.display='block';host.style.width='700px'});
      // Multiple kanji anchors in one canonical run; combining/emoji projection
      // and overlapping/instant source intervals must never fragment that owner.
      for(const input of [
        {texts:[['胸と彩を',1,4],['後',6,8]],tokens:[{surface_form:'胸',reading:'ムネ'},{surface_form:'と'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'を'},{surface_form:'後',reading:'アト'}]},
        {texts:[['e',1,2],['\u0301胸',4,5],['👩',5,6],['\u200d💻',5.5,7]],tokens:[{surface_form:'e\u0301'},{surface_form:'胸',reading:'ムネ'},{surface_form:'👩\u200d💻'}]},
        {texts:[['漢',1,2],['字',4,5],['彩',4.5,6],['点',6,6]],tokens:[{surface_form:'漢字',reading:'カンジ'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'点',reading:'テン'}]}
      ]){
        const doc=makeDoc(input.texts),group=document.createElement('button');group.className='VocalsGroup';hosts[1].append(group);
        const count=CreateRenderingCounters(),controller=new VocalController(group,doc,doc.groups[0].voices[0],{...ClassicRendering,blur:false},count);owned.push(controller);
        const root=group.firstElementChild,nodes=[...root.querySelectorAll('.Synced')],runs=AlignJapanese(doc.groups[0].voices[0],input.tokens,'kana',kana);
        controller.SetAnnotations(settings,undefined,runs,0);controller.MeasureAnnotations();
        for(const time of [0,1.5,3,4.75,6,9,1.25])controller.Animate(time,1/60,true);
        check(nodes.every((node,index)=>node===root.querySelectorAll('.Synced')[index]),'complex source boundaries/overlap/points/seek retain canonical primary nodes');
      }
      // A complete grouped reading crossing visual Line rows anchors to its
      // FIRST source fragment, retaining one honest full mapping, never omitted
      // or split into invented phonetic timing.
      const doc=makeDoc([['漢字漢字漢字',1,4],['後',6,8]],true),group=document.createElement('button');group.className='VocalsGroup';hosts[1].append(group);hosts[1].style.width='100px';
      const controller=new VocalController(group,doc,doc.groups[0].voices[0],minimal);owned.push(controller);
      const runs=AlignJapanese(doc.groups[0].voices[0],[{surface_form:'漢字漢字漢字',reading:'カンジカンジカンジ'},{surface_form:'後',reading:'アト'}],'kana',kana);
      controller.SetAnnotations(settings,undefined,runs,0);controller.MeasureAnnotations();
      const reading=group.querySelector('.RubyReading'),source=group.querySelector('.RubyPrimary .Line'),range=document.createRange(),textNode=[...source.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);range.setStart(textNode,0);range.setEnd(textNode,6);
      const fragments=[...range.getClientRects()];check(fragments.length>1&&!reading.parentElement.hidden,'valid wrapped grouped reading remains visible');
      check(reading.textContent==='かんじかんじかんじ'&&reading.getBoundingClientRect().bottom<=fragments[0].top+1,'complete reading stays above first source fragment');
      const newlineDoc=makeDoc([['前'+String.fromCharCode(10)+'胸を',1,4],['後',6,8]],true),newlineGroup=document.createElement('button');newlineGroup.className='VocalsGroup';hosts[1].append(newlineGroup);
      const newline=new VocalController(newlineGroup,newlineDoc,newlineDoc.groups[0].voices[0],minimal);owned.push(newline);
      const newlineRuns=AlignJapanese(newlineDoc.groups[0].voices[0],[{surface_form:'前'},{surface_form:String.fromCharCode(10)},{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:'後'}],'kana',kana);
      const sourceMarkup=root=>{const copy=root.cloneNode(true);copy.querySelectorAll('.RubyLineSpacer').forEach(node=>node.remove());for(const node of copy.querySelectorAll('.Line')){node.classList.remove('RubyLineLayout');node.style.removeProperty('line-height');if(!node.getAttribute('style'))node.removeAttribute('style')}return copy.innerHTML};
      const newlineRoot=newlineGroup.firstElementChild,beforeNewline=sourceMarkup(newlineRoot),newlineNodes=[...newlineRoot.querySelectorAll('*')];
      newline.SetAnnotations(settings,undefined,newlineRuns,0);newline.MeasureAnnotations();
      check(newlineRoot.querySelector('br')&&!newlineGroup.querySelector('.RubyReading').parentElement.hidden,'source BR counts as newline for later safe kanji offsets');
      check(sourceMarkup(newlineRoot)===beforeNewline&&newlineNodes.every((node,index)=>node===newlineRoot.querySelectorAll('*:not(.RubyLineSpacer)')[index]),'newline source nodes/text remain exact with only an empty layout exclusion');
      // Fault-injected noncanonical text is not rewritten by the mapper. With
      // no trustworthy anchors it removes all additional reading clearance.
      newline.SetProjection([{...newlineRuns[0],Text:'unmapped',IsPartOfWord:false}],0);const unmappedText=sourceMarkup(newlineRoot);newline.MeasureAnnotations(1);check(sourceMarkup(newlineRoot)===unmappedText,'unsafe mapper never rewrites primary text');
      const unmappedOwner=newlineGroup.querySelector('.RubyVocals');check(unmappedOwner.classList.contains('RubyNoReadings')&&getComputedStyle(unmappedOwner).paddingTop==='0px'&&!newline.RequiresContinuous(),'all-unmappable layer contributes no blank band/effect work');
      // An unsafe Line mapping must remove its leading override as well as
      // padding. Both source-Line and forced-Line match ordinary Original.
      for(const lineSource of [false,true]){
        const fallbackDoc=makeDoc([['胸を',1,4],['後',6,8]],lineSource),profile={...minimal,detail:'line'};
        const groups=[0,1].map(()=>{const group=document.createElement('button');group.className='VocalsGroup';hosts[0].append(group);return group});
        const pair=groups.map(group=>{const controller=new VocalController(group,fallbackDoc,fallbackDoc.groups[0].voices[0],profile);owned.push(controller);return controller});
        const roots=groups.map(group=>group.firstElementChild);
        const mapped=AlignJapanese(fallbackDoc.groups[0].voices[0],[{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:'後'}],'kana',kana);
        pair[1].SetAnnotations(settings,undefined,mapped,0);
        const projection=[{...mapped[0],Text:'unmapped',IsPartOfWord:false}];pair.forEach(controller=>controller.SetProjection(projection,0));pair[1].MeasureAnnotations();
        check(groups[1].querySelector('.RubyNoReadings'),'unsafe Line mapping disables ruby clearance');
        const leading=roots.map(root=>getComputedStyle(root.querySelector('.Line')).lineHeight),heights=roots.map(root=>root.getBoundingClientRect().height);
        check(leading[0]===leading[1]&&Math.abs(heights[0]-heights[1])<.01,'unmappable '+(lineSource?'true':'forced')+' Line preserves Original leading and height');
      }
      // Hidden entries own no continuing spring work. Real layout arrival pulls
      // the current clock, even while paused after skipped hidden visual ticks.
      // Pass6 wraps the former18px overflow case back into the column. A
      // genuinely unavailable zero-width surface is the hidden-work fixture.
      hosts[0].style.width='0px';const hiddenDoc=makeDoc([['前前前胸を',1,4],['後',6,8]]),hiddenGroup=document.createElement('button');hiddenGroup.className='VocalsGroup';hosts[0].append(hiddenGroup);
      let now=0;const count=CreateRenderingCounters(),hidden=new VocalController(hiddenGroup,hiddenDoc,hiddenDoc.groups[0].voices[0],minimal,count,undefined,()=>now);owned.push(hidden);
      const hiddenRuns=AlignJapanese(hiddenDoc.groups[0].voices[0],[{surface_form:'前前前'},{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:'後'}],'kana',kana);
      const animated=NormalizeAnnotations();for(const sourceCase of ['Word','Line'])animated.cases[sourceCase]={inherit:false,effects:{...ClassicRendering,blur:false,emphasis:false}};
      hidden.SetAnnotations(animated,undefined,hiddenRuns,0);hidden.MeasureAnnotations();check(hidden.ruby.entries.every(entry=>entry.host.hidden)&&hidden.ruby.fitKey==='','zero geometry is not cached as a valid fit');const updates=count.springUpdates;
      for(let index=0;index<100;index++)hidden.Animate(index/20,1/60);
      check(count.springUpdates===updates&&!hidden.RequiresContinuous()&&!hidden.NeedsFrame(),'unrenderable readings stop frame/spring work');
      now=2.5;hosts[0].style.width='700px';hidden.MeasureAnnotations(1);
      const revealed=hiddenGroup.querySelector('.RubyReading');check(!revealed.parentElement.hidden&&Math.abs(parseFloat(revealed.querySelector('.Synced').style.getPropertyValue('--gradient-progress'))-40)<.001,'paused reveal snaps reading to current mapped phase');
      hidden.SetAnnotations({...animated,alignment:'end'},hiddenRuns,hiddenRuns,now);hidden.MeasureAnnotations(2);
      const owner=hiddenGroup.querySelector('.VoiceBlock');check(owner.dataset.annotationAlign==='end','combined row/ruby stores effective ancestor alignment');
      const first=hiddenGroup.querySelector('.RubyAnnotation').style.translate;hidden.SetAnnotations({...animated,alignment:'start'},hiddenRuns,hiddenRuns,now);hidden.MeasureAnnotations(2);
      check(hiddenGroup.querySelector('.RubyAnnotation').style.translate!==first,'ancestor alignment invalidates cached reading placement');
      // At small fonts the existing fixed-pixel glow radius dominates glyph
      // height. Include its conservative painted spread, not only text boxes.
      hosts[0].style.setProperty('--minimum-lyrics-size','24px');hosts[0].style.setProperty('--maximum-lyrics-size','24px');
      for(const line of [false,true]){
        const glowDoc=makeDoc([['胸',1,4],['を',4,8]],line),glowGroup=document.createElement('button');glowGroup.className='VocalsGroup';hosts[0].append(glowGroup);
        const glowing=new VocalController(glowGroup,glowDoc,glowDoc.groups[0].voices[0],{...ClassicRendering,blur:false});owned.push(glowing);
        const glowRuns=AlignJapanese(glowDoc.groups[0].voices[0],[{surface_form:'胸',reading:'ムネ'},{surface_form:'を'}],'kana',kana);
        glowing.SetAnnotations(NormalizeAnnotations(),undefined,glowRuns,0);glowing.MeasureAnnotations();
        const owner=glowGroup.querySelector('.RubyVocals'),reading=glowGroup.querySelector('.RubyReading');check(!reading.parentElement.hidden,'glowing reading remains renderable');
        for(const time of [1.1,1.75,2.5,3.25,4.5,6]){
          glowing.Animate(time,1/60,true);const glyph=reading.querySelector('.Synced'),rect=glyph.getBoundingClientRect(),bounds=owner.getBoundingClientRect();
          const spread=parseFloat(glyph.style.getPropertyValue('--text-shadow-blur-radius'))*1.5*1.1;
          check(rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1,'Classic readable glyph/scale/motion envelope fits owner at small font '+JSON.stringify({line,time,rect:rect.toJSON(),bounds:bounds.toJSON(),host:reading.parentElement.style.cssText,owner:owner.style.cssText}));
          // Soft halo can clip at the existing outer viewport; legacy spline
          // overshoot is not a reason to detach a reading from its kanji.
          if(line&&time===6)check(spread>18,'existing Line glow overshoot remains unmodified');
        }
        glowing.SetAnnotations(settings,undefined,glowRuns,6);glowing.MeasureAnnotations();check(!owner.style.getPropertyValue('--ruby-effect-reserve'),'soft glow never adds a typographic clearance band');
      }

    },sourceFrames(){
      clear();hosts.forEach(host=>{host.style.display='block';host.style.width='180px'});
      for(const line of [false,true])for(const role of [0,1]){
        const doc=makeDoc([['て胸を',1,4],['焦がしてしまう',4,8]],line),group=document.createElement('button');group.className='VocalsGroup';hosts[0].append(group);
        const controller=new VocalController(group,doc,doc.groups[0].voices[role],{...ClassicRendering,blur:false});owned.push(controller);
        const root=group.firstElementChild,runs=AlignJapanese(doc.groups[0].voices[role],[{surface_form:'て'},{surface_form:'胸',reading:'ムネ'},{surface_form:'を'},{surface_form:'焦がし',reading:'コガシ'},{surface_form:'てしまう'}],'kana',kana);
        controller.SetAnnotations(NormalizeAnnotations(),undefined,runs,0);controller.MeasureAnnotations();
        for(const [index,time] of [1.01,1.2,1.7,2.4,3.2,5.3,7,1.1].entries()){
          hosts[0].style.width=[180,400,140,700][index%4]+'px';
          hosts[0].style.setProperty('--minimum-lyrics-size',index%2?'24px':'42px');hosts[0].style.setProperty('--maximum-lyrics-size',index%2?'24px':'42px');
          controller.Animate(time,1/60);controller.MeasureAnnotations();
          const layer=controller.ruby,frame=layer.sourceFrame(1),pieces=layer.entries.flatMap(entry=>entry.pieces||[]);
          const rest=pieces.map(piece=>[...piece.range().getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>frame(rect,piece.parent)));
          const owner=layer.Element.getBoundingClientRect(),font=parseFloat(getComputedStyle(root).fontSize),gap=Math.max(1,font*.04);
          for(const entry of layer.entries.filter(entry=>!entry.host.hidden)){
            const rects=entry.pieces.flatMap(piece=>[...piece.range().getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>frame(rect,piece.parent)));
            const sourceTop=Math.min(...rects.map(rect=>rect.top))-owner.top,fit=Number(entry.root.style.getPropertyValue('--ruby-fit')),visual=entry.root.dataset.jelScale==='on'?1.1:1;
            const predicted=parseFloat(entry.host.style.translate.split(' ')[1]),center=entry.metrics.height/2;
            const expected=sourceTop-(center+(entry.metrics.inkBottom-center)*visual)*fit-gap;
            check(Math.abs(predicted-expected)<.12,'reading clearance follows actual current source anchor after resize '+JSON.stringify({line,role,index,predicted,expected}));
          }
          root.classList.add('NeutralSource');
          const neutral=pieces.map(piece=>[...piece.range().getClientRects()].filter(rect=>rect.width&&rect.height));
          root.classList.remove('NeutralSource');
          check(rest.every((rects,index)=>rects.length===neutral[index].length&&rects.every((rect,j)=>['left','top','right','bottom'].every(key=>Math.abs(rect[key]-neutral[index][j][key])<.08))),'live source frame exactly matches effect-neutral fractional glyph geometry across phase/seek '+JSON.stringify({line,role,time,rest,neutral:neutral.map(rects=>rects.map(rect=>rect.toJSON()))}));
        }
      }
    },mixedRows(){
      clear();hosts[0].style.display='block';
      const texts=[['胸',1,2,false],['あの',2,3,true],['夜',3,4,false],['かなかな',4,5,false],['語',5,7,false],['し',7,8,false]];
      for(const role of [0,1])for(const font of [24,42])for(const size of [.25,.5,1]){
        const doc=makeDoc(texts),voice=doc.groups[0].voices[role],group=document.createElement('button');group.className='VocalsGroup';hosts[0].append(group);
        const controller=new VocalController(group,doc,voice,{...ClassicRendering,blur:false}),root=group.firstElementChild;owned.push(controller);
        const runs=AlignJapanese(voice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'あの'},{surface_form:'夜',reading:'ヨル'},{surface_form:'かなかな'},{surface_form:'語',reading:'ゴ'},{surface_form:'し'}],'kana',kana);
        hosts[0].style.setProperty('--minimum-lyrics-size',font+'px');hosts[0].style.setProperty('--maximum-lyrics-size',font+'px');
        controller.SetAnnotations({...NormalizeAnnotations(),rubySize:size},undefined,runs,0);
        for(const width of [700,180,130,400]){
          hosts[0].style.width=width+'px';controller.MeasureAnnotations();
          root.classList.add('NeutralSource');
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),rows=[];let node;
          while(node=walker.nextNode()){
            const range=document.createRange();range.selectNodeContents(node);
            for(const rect of range.getClientRects())if(rect.width){const row=rows.find(row=>Math.abs(row[0].top-rect.top)<2);if(row)row.push(rect);else rows.push([rect]);}
          }
          root.classList.remove('NeutralSource');
          check(rows.every(row=>Math.max(...row.map(rect=>rect.bottom))-Math.min(...row.map(rect=>rect.bottom))<1),'mixed direct/Word/emphasis source glyph baselines stay equal per visual row');
          check([...root.children].some(item=>item.classList.contains('Word'))&&root.querySelector('.Letter'),'fixture includes grouped and independently emphasized source owners');
          const plain=[...root.children].find(item=>item.textContent==='かなかな');check(plain&&!plain.style.marginBlockStart,'unannotated source item carries no reading clearance');
          const layer=controller.ruby,frame=layer.sourceFrame(1),bounds=layer.Element.getBoundingClientRect();
          for(const entry of layer.entries.filter(entry=>!entry.host.hidden)){
            const rects=entry.pieces.flatMap(piece=>[...piece.range().getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>frame(rect,piece.parent)));
            const center=entry.metrics.height/2,extent=center+(entry.metrics.inkBottom-center)*1.1;
            const expected=Math.min(...rects.map(rect=>rect.top))-bounds.top-extent*Number(entry.root.style.getPropertyValue('--ruby-fit'))-Math.max(1,parseFloat(getComputedStyle(root).fontSize)*.04);
            check(Math.abs(parseFloat(entry.host.style.translate.split(' ')[1])-expected)<.12,'mixed row reading remains attached after baseline-driven rewrap');
          }
        }
        controller.Destroy();owned.pop();group.remove();
      }
    },fallbacks(){
      clear();hosts[0].style.display='block';hosts[0].style.width='140px';hosts[0].style.setProperty('--minimum-lyrics-size','32px');hosts[0].style.setProperty('--maximum-lyrics-size','32px');
      {
        const text='胸の彩を夜の君へ胸の彩を';
        const doc=NormalizeLyrics({Type:'Static',Lines:[{Text:text}]}),voice=doc.groups[0].voices[0];
        const group=document.createElement('button');group.className='VocalsGroup';hosts[0].append(group);
        const count=CreateRenderingCounters(),controller=new VocalController(group,doc,voice,minimal,count);owned.push(controller);
        const root=group.firstElementChild,runs=AlignJapanese(voice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'の'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'を'},{surface_form:'夜',reading:'ヨル'},{surface_form:'の'},{surface_form:'君',reading:'キミ'},{surface_form:'へ'},{surface_form:'胸',reading:'ムネ'},{surface_form:'の'},{surface_form:'彩',reading:'イロドリ'},{surface_form:'を'}],'kana',kana);
        const originalNodes=[...root.querySelectorAll('*')],originalAlignment=getComputedStyle(root).alignItems,originalHeight=root.offsetHeight;controller.SetAnnotations(settings,undefined,runs,0);controller.MeasureAnnotations();
        const layer=controller.ruby,owner=layer.Element,readingRects=[...owner.querySelectorAll('.RubyAnnotation:not([hidden])')].map(node=>node.getBoundingClientRect());
        check(readingRects.length===6&&root.querySelector('.Static'),'true plain wrapped fixture keeps every safe reading');
        for(let a=0;a<readingRects.length;a++)for(let b=a+1;b<readingRects.length;b++){
          const x=readingRects[a],y=readingRects[b];check(x.right<=y.left+1||y.right<=x.left+1||x.bottom<=y.top+1||y.bottom<=x.top+1,'wrapped plain reading rows do not collide');
        }
        check(root.textContent===text&&originalNodes.every((node,index)=>node===root.querySelectorAll('*:not(.RubyLineSpacer)')[index]),'plain primary nodes/text stay exact with only an empty layout exclusion');
        for(let index=0;index<100;index++)controller.Animate(index/10,1/60);
        check(count.springsAllocated===0&&!controller.NeedsFrame()&&!controller.RequiresContinuous(),'plain readings allocate no animated work');
        // Unsupported external transforms safely retain Original without readings.
        const source=root.querySelector('.Static');source.style.transform='rotate(2deg)';
        controller.MeasureAnnotations(1);check(owner.classList.contains('RubyNoReadings')&&!owner.querySelector('.RubyAnnotation:not([hidden])'),'unsupported external transform falls back safely to unchanged source');
        check(source.style.transform==='rotate(2deg)','unsupported fallback never changes external source effect');check(getComputedStyle(root).alignItems===originalAlignment&&root.offsetHeight===originalHeight,'unsupported no-readings fallback keeps Original alignment and source height');
        source.style.removeProperty('transform');controller.MeasureAnnotations(2);check(owner.querySelectorAll('.RubyAnnotation:not([hidden])').length===6,'supported layout recovers full readings on real invalidation');
        // Failure after reserve clears every style that owns reading clearance.
        const job=layer.PrepareLayout(3,0);job.prepare();job.measure();job.reserve();job.cleanup();
        check(!source.style.lineHeight&&getComputedStyle(owner).paddingTop==='0px'&&owner.classList.contains('RubyNoReadings'),'failed layout clears plain leading and padding');
        controller.MeasureAnnotations(4);check(owner.querySelector('.RubyAnnotation:not([hidden])'),'real invalidation recovers after omitted failed layout');
        controller.SetProjection([{...runs[0],Text:'unmapped',IsPartOfWord:false}],0);controller.MeasureAnnotations(5);
        check(!source.style.lineHeight&&getComputedStyle(owner).paddingTop==='0px'&&!controller.RequiresContinuous(),'previously wrapped all-unmappable plain removes every clearance style');
        controller.Destroy();owned.pop();group.remove();
      }
    },sourceLifecycle(){
      clear();hosts[0].style.display='block';hosts[0].style.width='400px';
      const doc=makeDoc([['胸',1,4,false],['彩',4,8,false]]),voice=doc.groups[0].voices[0],group=document.createElement('button');group.className='VocalsGroup';hosts[0].append(group);
      const profile={...ClassicRendering,blur:false},controller=new VocalController(group,doc,voice,profile);owned.push(controller);
      const runs=AlignJapanese(voice,[{surface_form:'胸',reading:'ムネ'},{surface_form:'彩',reading:'イロドリ'}],'kana',kana);
      controller.SetAnnotations(settings,undefined,runs,0);controller.MeasureAnnotations();
      const layer=controller.ruby,oldItems=[...layer.reserved];check(oldItems.length>0,'fixture owns source item clearance before replacement');
      controller.SetProjection(fixtureModule.LayoutVoice(voice).map(run=>({...run})),0);
      check(layer.reserved.size===0&&layer.marginKeys.size===0&&oldItems.every(item=>!item.isConnected),'source replacement releases detached margin owners');
      controller.MeasureAnnotations();check(layer.entries.every(entry=>entry.pieces?.every(piece=>piece.parent.isConnected)),'new source offsets remap current nodes');
      const beforeEmphasis=[...layer.reserved];controller.SetRendering({...profile,emphasis:false},0);
      check(layer.reserved.size===0&&layer.marginKeys.size===0&&beforeEmphasis.every(item=>!layer.marginKeys.has(item)),'emphasis rebuild releases prior source references');
      controller.MeasureAnnotations(1);check(layer.entries.some(entry=>!entry.host.hidden),'font invalidation after source rebuild keeps mapped readings');
      controller.SetAnnotations(NormalizeAnnotations(),undefined,undefined,0);controller.MeasureAnnotations(2);
      check(!group.querySelector('.RubyVocals')&&!group.querySelector('[style*="margin-block-start"]'),'Off removes rebuilt source clearance/layer');
    },finish(){clear();jelTestComplete('RUBY_LAYER_PASS')}};
  })();`;
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-ruby-layer-')));
  try{
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><body class="PaintOnly"><style>*{box-sizing:border-box}${css}body{margin:0;background:#233}.NeutralSource,.NeutralSource *{transform:none!important;scale:none!important;transition:none!important}.shell{--minimum-lyrics-size:32px;--maximum-lyrics-size:32px}.Vocals,.Line{transition:none!important}.PaintOnly .RubyAnnotation{visibility:hidden}</style><script>${script.replaceAll('</script','<\/script')}</script>`);
    const result=await runFocusedFixture(chrome,file,path.join(directory,'profile'),async command=>{
      const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value};
      await evaluate('new Promise((resolve,reject)=>{let count=0;function ready(){if(globalThis.rubyFixture)return resolve(true);if(++count>120)return reject(Error("fixture initialization"));requestAnimationFrame(ready)}ready()})');
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      for(const detail of ['word','forcedLine','trueLine'])for(const emphasis of [false,true]){
        await evaluate(`rubyFixture.setup(${JSON.stringify(detail)},${emphasis})`);
        for(const time of [2.2,2.5,5]){
          await evaluate(`rubyFixture.step(${time})`);const captures=[];
          for(const index of [0,1]){const clip=await evaluate(`rubyFixture.paint(${index})`);captures.push((await command('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:true})).data)}
          assert.ok(captures[1]===captures[0],`actual source paint differs: ${detail}/emphasis${emphasis}/time${time}`);
          if(time===2.2)await evaluate('rubyFixture.toggle()');
        }
        for(const time of [9,0,4,3,1.5])await evaluate(`rubyFixture.step(${time},true)`);
      }
      await evaluate('rubyFixture.geometry()');await evaluate('rubyFixture.hardCases()');await evaluate('rubyFixture.sourceFrames()');await evaluate('rubyFixture.mixedRows()');await evaluate('rubyFixture.fallbacks()');await evaluate('rubyFixture.sourceLifecycle()');await evaluate('rubyFixture.finish()');
    });
    assert.equal(result,'RUBY_LAYER_PASS',result);
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-ruby-layer-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
