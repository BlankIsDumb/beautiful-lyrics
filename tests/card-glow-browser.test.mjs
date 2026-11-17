import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as sass from 'sass';
import {buildVocalFixture} from './renderer-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';

const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('mounted card: clip edges sit 16px outside the unchanged text column on both sides', {skip:!chrome},async()=>{
  // Real card, renderer and scroller with the host's border-box sizing. The
  // glow pixels themselves are checked outside this suite.
  const {code,css}=await buildVocalFixture(undefined,true,false,true,true,true);
  const cardCSS=sass.compile('Extension/Source/LyricViews/Card/style.scss').css;
  const script=`(async()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const near=(a,b,message,tolerance=.5)=>check(Math.abs(a-b)<=tolerance,message+' '+a+' / '+b);
    const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const settle=async()=>{await frame();await frame();await frame()};
    localStorage.clear();
    let time=1.5;const consumers=new Set();
    globalThis.fixtureClock={now:()=>time,duration:()=>100,seek(){throw Error('Unexpected seek')},subscribe(fn){consumers.add(fn);return()=>consumers.delete(fn)}};
    ${code}
    const m=fixtureModule,p=m.PresentationSettings;
    p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),transition:'instant',cardHeight:'default'});
    p.saveCues('NowPlaying',{...p.getCues('NowPlaying'),threshold:0});
    const host=document.createElement('div');host.style.cssText='width:760px;height:1400px;container-type:size;position:relative';document.body.append(host);
    const anchor=document.createElement('div');host.append(anchor);
    const source=(opposite=false)=>({Type:'Line',NaturalAlignment:'Left',StartTime:1,EndTime:81,Source:{Provider:'LRCLIB',HasWordSync:false},
      Content:Array.from({length:20},(_,i)=>({Type:'Vocal',OppositeAligned:opposite&&i===0,Text:'Source group '+i,StartTime:1+i*4,EndTime:3+i*4}))});
    let view;
    const mount=async lyrics=>{view?.Destroy();m.SetSong(lyrics);view=new m.CardView(anchor);await settle();for(const consume of consumers)consume(0,true);await settle();return host.querySelector('#BeautifulLyrics-CardView')};
    try{
      let card=await mount(source());
      const outer=card.querySelector(':scope > .LyricsContent'),container=outer.querySelector(':scope > .ContentContainer');
      check(outer&&container,'card structure');
      const box=element=>element.getBoundingClientRect(),edge=box(outer);
      const port=card.querySelector('.simplebar-content-wrapper'),scroll=card.querySelector('.LyricsScrollContainer'),lyrics=card.querySelector('.Lyrics');
      for(const [name,element] of [['scrollport',port],['scroll container',scroll],['content container',container]]) {
        near(box(element).left,edge.left,name+' left matches LyricsContent');near(box(element).right,edge.right,name+' right matches LyricsContent');
      }
      near(box(lyrics).left,edge.left+16,'lyric root left keeps 16px inset');near(box(lyrics).width,edge.width-32,'lyric root width unchanged');
      const groups=[...card.querySelectorAll('.VocalsGroup')].filter(group=>group.querySelector('.Line'));
      check(groups.length===20,'twenty line groups');
      const line=groups[0].querySelector('.Line');check(line.closest('.Vocals').classList.contains('Active'),'first line active');
      near(box(line).left,box(lyrics).left,'active line text starts at lyric root left',1);
      const track=card.querySelector('.simplebar-track.simplebar-vertical');check(track,'vertical track exists');
      near(box(track).right,box(lyrics).right,'scrollbar track right edge matches lyric root');
      check(port.scrollWidth===port.clientWidth,'no horizontal scrolling '+port.scrollWidth+' / '+port.clientWidth);
      card=await mount(source(true));
      const opposite=[...card.querySelectorAll('.VocalsGroup')].find(group=>group.querySelector('.Line'));
      check(opposite.classList.contains('AlignedOpposite'),'first line is opposite aligned');
      near(box(opposite.querySelector('.Line')).right,box(card.querySelector('.Lyrics')).right,'opposite line ends at lyric root right',1);
      for(const [value,height] of [['default',267],['extended',427],['max',547]]) {
        p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:value});await settle();
        near(box(card.querySelector('.ContentContainer')).height,height,value+' content height unchanged');
      }
      view.Destroy();await settle();check(consumers.size===0,'renderer clock cleanup');
      jelTestComplete('CARD_GLOW_PASS');
    }catch(error){jelTestComplete('CARD_GLOW_FAIL: '+error.stack)}finally{view?.Destroy();host.remove()}
  })();`;
  const ascii=script.replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-card-glow-')));
  try {
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><body><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}${css}${cardCSS}</style><script>${ascii.replaceAll('</script','<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'CARD_GLOW_PASS');
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-card-glow-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
