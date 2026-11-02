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
test('real card/page/cinema preserve responsive1x container curve and current probe readouts across ratio/rem/column changes', {skip:!chrome},async()=>{
 const {code,css}=await buildVocalFixture(undefined,false,false,true);
 const surfaces=['Extension/Source/LyricViews/Card/style.scss','Extension/Source/LyricViews/Page/style.scss','Extension/Source/Stylings/TypographyPreview.scss'].map(file=>sass.compile(file).css).join('\n');
 const script=`(async()=>{${code}
  const {Current,ApplyLayoutStyle,ClassicLayout,PresentationSettings,CreateTypographyPreview,RegisterTypography,TypographyMeasured}=fixtureModule;
  const check=(ok,message)=>{if(!ok)throw Error(message)};
  const near=(a,b,label)=>check(Math.abs(a-b)<.08,label+' '+a+' / '+b);
  const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const all=[];
  function mount(kind,width,height=700){
   const host=document.createElement('div');host.className='SurfaceHost';host.style.cssText='width:'+width+'px;height:'+height+'px;position:relative;container-type:size';document.body.append(host);
   let column;
   if(kind==='Card') { host.innerHTML='<div id="BeautifulLyrics-CardView"><div class="LyricsContent"><div class="ContentContainer"></div></div></div>';column=host.querySelector('.ContentContainer'); }
   else {host.classList.add('Root__main-view');host.innerHTML='<div class="BeautifulLyricsPage '+kind+'"><div class="Content"></div></div>';column=host.querySelector('.Content');}
   const scroll=document.createElement('div');scroll.className='LyricsScrollContainer';const root=document.createElement('div');root.className='Lyrics NaturallyAlignedLeft';root.style.height='200px';scroll.append(root);column.append(scroll);
   const group=document.createElement('button');group.className='VocalsGroup';root.append(group);
   const source=[{Text:'source',StartTime:1,EndTime:2,IsPartOfWord:false}];const lead=new Current(group,source,false,false),backing=new Current(group,source,true,false);
   const result={host,root,group,lead,backing,destroy(){lead.Destroy();backing.Destroy();host.remove()}};all.push(result);return result;
  }
  try{
   let cases=0;
   for(const rem of [16,20])for(const width of [280,620,1200])for(const kind of ['Card','Contained','Fullscreen']){
    document.documentElement.style.fontSize=rem+'px';const item=mount(kind,width);await wait();
    const box=item.root.getBoundingClientRect(),style=getComputedStyle(item.root),columnWidth=box.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const expected=Math.max(rem*1.85,Math.min(columnWidth*.07,rem*3.5));
    for(const ratio of [.5,1,1.35,2]) {
     ApplyLayoutStyle(item.root,{...ClassicLayout,primaryRatio:ratio,backingRatio:.6},'');
     near(parseFloat(getComputedStyle(item.group.querySelector('.Lead')).fontSize),expected*ratio,kind+' complete clamp multiplier');
     near(parseFloat(getComputedStyle(item.group.querySelector('.Background')).fontSize),expected*ratio*.6,kind+' independent backing');cases++;
    }
    // The actual source/root hierarchy is unchanged; four-em clamp lives inside
    // its column and never narrows the responsive query container itself.
    const original=columnWidth;ApplyLayoutStyle(item.root,{...ClassicLayout,inset:128},'');
    near(item.root.getBoundingClientRect().width-parseFloat(getComputedStyle(item.root).paddingLeft)-parseFloat(getComputedStyle(item.root).paddingRight),original,kind+' unchanged cqw container');
    const groupWidth=item.group.getBoundingClientRect().width;check(groupWidth>=Math.min(original,expected*4)-.1,kind+' four-em minimum column');
    if(kind==='Fullscreen')check(parseFloat(getComputedStyle(item.root).paddingLeft)>width*.3,'artwork reservation stays intact');
    item.destroy();
   }
   check(cases===72,'full responsive curve matrix');
   // Actual unmounted probes and mounted samples at identical current geometry.
   document.documentElement.style.fontSize='16px';
   for(const kind of ['Card','Contained','Fullscreen']) {
    const item=mount(kind,kind==='Fullscreen'?window.innerWidth:760,kind==='Fullscreen'?window.innerHeight:700),view=kind==='Card'?'NowPlaying':'FullLyrics';await wait();
    const form=document.createElement('form');document.body.append(form);
    const primary=document.createElement('output'),backing=document.createElement('output');form.append(primary,backing);
    const outputs=new Map([[view,{primary,backing}]]),dispose=CreateTypographyPreview(form,outputs);
    await wait();await wait();const predicted=parseFloat(primary.textContent),actual=parseFloat(getComputedStyle(item.group.querySelector('.Lead')).fontSize);
    near(predicted,actual,kind+' unmounted text-only probe parity');
    const unregister=RegisterTypography(view,item.root);TypographyMeasured();await wait();near(parseFloat(primary.textContent),actual,kind+' mounted actual readout');unregister();
    document.documentElement.style.fontSize='20px';await wait();await wait();near(parseFloat(primary.textContent),parseFloat(getComputedStyle(item.group.querySelector('.Lead')).fontSize),kind+' root-rem-only update');
    dispose();check(!document.querySelector('.JEL-TypographyPreview'),'probe cleanup');form.remove();item.destroy();document.documentElement.style.fontSize='16px';
   }
   jelTestComplete('LAYOUT_BROWSER_PASS');
  }catch(error){jelTestComplete('LAYOUT_BROWSER_FAIL: '+error.stack)}finally{all.forEach(item=>item.destroy())}
 })();`;
 const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-layout-')));
 try{const file=path.join(directory,'fixture.html');await writeFile(file,`<!doctype html><meta charset="utf-8"><body><style>*{box-sizing:border-box}${css}${surfaces}body{margin:0;font-family:sans-serif}.SurfaceHost{--spice-sidebar:#222}</style><script>${script.replaceAll('</script','<\\/script')}</script>`);assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'LAYOUT_BROWSER_PASS');}
 finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-layout-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
