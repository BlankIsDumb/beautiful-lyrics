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
test('mounted card: measured credit rows, fixed header, legacy collapse, live height and effective Max follow', {skip:!chrome},async()=>{
  // Real card, renderer and scroller. Only host/player clock, legacy cache and
  // background painting are substituted; this fixture does not test tinting.
  const {code,css}=await buildVocalFixture(undefined,true,false,true,true,true);
  const cardCSS=sass.compile('Extension/Source/LyricViews/Card/style.scss').css;
  const script=`(async()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const near=(a,b,message)=>check(Math.abs(a-b)<1,message+' '+a+' / '+b);
    const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const settle=async()=>{await frame();await frame();await frame()};
    const key='BeautifulLyrics/LyricViews',legacy=JSON.stringify({Version:1,Items:{CardLyricsVisible:false}});
    localStorage.clear();localStorage.setItem(key,legacy);
    let time=41.5,clockTicks=0;const consumers=new Set();
    globalThis.fixtureClock={now:()=>time,duration:()=>100,seek(){throw Error('Unexpected seek')},subscribe(fn){consumers.add(fn);return()=>consumers.delete(fn)}};
    ${code}
    const m=fixtureModule,p=m.PresentationSettings;
    p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),transition:'instant'});
    p.saveCues('NowPlaying',{...p.getCues('NowPlaying'),threshold:0});
    p.saveRendering('NowPlaying','Line',m.ApplyTextPreset(p.getRendering('NowPlaying','Line'),'minimal'));
    const host=document.createElement('div');host.style.cssText='width:760px;height:1400px;container-type:size;position:relative';document.body.append(host);
    const anchor=document.createElement('div');host.append(anchor);
    const source=(provider='Spicy',people=[])=>({Type:'Line',NaturalAlignment:'Left',StartTime:1,EndTime:81,
      Source:{Provider:provider,HasWordSync:false},Attribution:{Source:'spicy_lyrics',People:people},
      Content:Array.from({length:20},(_,i)=>({Type:'Vocal',Text:'Source group '+i,StartTime:1+i*4,EndTime:3+i*4}))});
    let view;
    const mount=async lyrics=>{view?.Destroy();m.SetSong(lyrics);view=new m.CardView(anchor);await settle();return host.querySelector('#BeautifulLyrics-CardView')};
    const people=[{Name:'Sppq',Role:'Uploader',URL:'https://spicylyrics.org/user/sppq'},{Name:'ShoQB',Role:'Maker',URL:'https://spicylyrics.org/user/shoqb'}];
    try{
      let card=await mount(source('Spicy',people));
      const credit=card.querySelector('.BL-CardCredit'),header=card.querySelector('.Header'),content=card.querySelector('.ContentContainer');
      check(!card.querySelector('.Controls,#Romanize,#Page,#Close,.ShowLyrics'),'card has no hover/collapse controls');
      check(card.querySelector('.Lyrics'),'legacy false still renders lyrics');
      check(m.Store.Items.CardLyricsVisible===false&&localStorage.getItem(key)===legacy,'legacy collapse value unchanged');
      check(credit.dataset.rows==='1'&&credit.textContent==='Sppq \u00b7 ShoQB \u00b7 Spicy Lyrics','fitting credit has people first');
      near(header.getBoundingClientRect().height,25,'fixed header height');
      check(getComputedStyle(credit).fontSize==='13px','credit font-size 13px');near(credit.getBoundingClientRect().height,16,'one row exactly 16px');
      const top=content.getBoundingClientRect().top-card.getBoundingClientRect().top,cardHeight=card.getBoundingClientRect().height;
      const link=credit.querySelector('a');check(link.title==='Uploader: Sppq'&&link.target==='_blank'&&link.rel==='noopener noreferrer','full title and safe link attributes');
      let bubbled=0;header.addEventListener('click',()=>bubbled++);
      credit.addEventListener('click',event=>event.preventDefault());link.click();check(bubbled===0,'credit clicks stop at credit');
      host.style.width='140px';await settle();
      check(credit.dataset.rows==='2','width observation switches to two rows');
      near(header.getBoundingClientRect().height,25,'header stays 25px');
      near(content.getBoundingClientRect().top-card.getBoundingClientRect().top,top,'lyrics top unchanged');
      near(card.getBoundingClientRect().height,cardHeight,'credit row count leaves card height unchanged');
      near(credit.getBoundingClientRect().height,32,'two rows exactly 32px');
      near(credit.getBoundingClientRect().top,header.getBoundingClientRect().top-3.5,'two rows centered on header');
      check(credit.children.length===2&&credit.firstElementChild.textContent==='Spicy Lyrics','provider in row one');
      for(const person of credit.querySelectorAll('.BL-CreditPerson')) {
        const style=getComputedStyle(person);check(person.scrollWidth>person.clientWidth&&person.clientWidth>0,'both names shrink and remain clickable');
        check(style.textOverflow==='ellipsis'&&style.whiteSpace==='nowrap','names end with ellipsis');near(person.getBoundingClientRect().height,16,'no third row');
      }
      host.style.width='760px';await settle();check(credit.dataset.rows==='1','resize restores single row');
      const longPeople=people.map(person=>({...person,Name:person.Name.repeat(100)}));
      card=await mount(source('Spicy',longPeople));check(card.querySelector('.BL-CardCredit').dataset.rows==='2','long content is measured at construction');
      card=await mount(source('An exceptionally long provider name '.repeat(20)));
      const single=card.querySelector('.BL-CardCreditLine');check(card.querySelector('.BL-CardCredit').dataset.rows==='1','no people remains single row');
      check(single.scrollWidth>single.clientWidth&&getComputedStyle(single).textOverflow==='ellipsis','single provider truncates');
      for(const [provider,sourceName,expected] of [['Musixmatch',null,'Musixmatch'],['Spicy','apple_music','Apple Music \u00b7 Spicy Lyrics'],['Spicy','unknown','Unknown source \u00b7 Spicy Lyrics']]) {
        const lyrics=source(provider);if(sourceName)lyrics.Attribution.Source=sourceName;
        card=await mount(lyrics);check(card.querySelector('.BL-CardCredit').textContent===expected,'single row source/provider order');
      }
      card=await mount(source());const mountedCard=card,mountedLyrics=card.querySelector('.Lyrics');
      // The renderer exposes context membership through its existing class.
      const allGroups=[...card.querySelectorAll('.VocalsGroup')].filter(group=>!group.querySelector('.Interlude'));
      const active=allGroups[10].querySelector('.Vocals'),earlier=allGroups[9];
      const center=()=>{const box=active.getBoundingClientRect(),port=card.querySelector('.simplebar-content-wrapper').getBoundingClientRect();return (box.top+box.bottom)/2-port.top};
      const voiceTop=group=>group.querySelector('.Vocals').getBoundingClientRect().top-card.querySelector('.simplebar-content-wrapper').getBoundingClientRect().top;
      const tick=async next=>{time=next;clockTicks++;for(const consume of consumers)consume(0,true);await settle()};
      const defaultCenter=center();check(earlier.classList.contains('ContextExcluded'),'default hides earlier lines');
      for(const [value,max,contentHeight,contentMax] of [['default',340,267,267],['extended',500,427,427],['max',620,547,547]]) {
        p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:value});await settle();
        check(host.querySelector('#BeautifulLyrics-CardView')===mountedCard&&card.querySelector('.Lyrics')===mountedLyrics,'height changes keep mounted card and renderer');
        check(card.dataset.cardHeight===value,'live height data attribute');near(parseFloat(getComputedStyle(card).maxHeight),max,'card max height');
        const content=card.querySelector('.ContentContainer');near(parseFloat(getComputedStyle(content).maxHeight),contentMax,'content cap');
        near(content.getBoundingClientRect().height,Math.min(1400*({default:.25,extended:.40,max:.51}[value]),contentHeight),'responsive content height');
        const loading=document.createElement('div');loading.className='LoadingLyricsCard';loading.dataset.cardHeight=value;host.append(loading);
        near(loading.getBoundingClientRect().height,max,'matching placeholder height');loading.remove();
        if(value==='max') {
          check(!earlier.classList.contains('ContextExcluded')&&allGroups[8].classList.contains('ContextExcluded'),'Max exposes exactly one earlier source group');
          near(voiceTop(earlier),8,'Max places earlier group at readable top');
          check(active.getBoundingClientRect().top>=earlier.querySelector('.Vocals').getBoundingClientRect().bottom,'active line sits directly after earlier source group');
          check(p.getLayout('NowPlaying').anchor===0&&p.getLayout('NowPlaying').before===0,'automatic lead never writes stored anchor or context');
        }
      }
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),before:2});await settle();
      near(voiceTop(earlier),8,'positive Lines before keeps automatic follow lead active');
      check(!allGroups[8].classList.contains('ContextExcluded'),'user context remains exactly two earlier groups');
      p.saveContextAppearance('NowPlaying',{...p.getContextAppearance('NowPlaying'),mode:'muted'});
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),before:null});await settle();
      near(voiceTop(earlier),8,'All earlier lines with top anchor keeps previous source at readable top');
      check(active.getBoundingClientRect().top>=earlier.querySelector('.Vocals').getBoundingClientRect().bottom,'All context keeps active line below its previous source');
      check(p.getLayout('NowPlaying').before===null&&p.getEffectiveLayout('NowPlaying').before===null,'All earlier lines stays stored and effective');
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),anchor:20});await settle();
      const anchorPort=card.querySelector('.simplebar-content-wrapper'),activeHeight=active.getBoundingClientRect().height;
      const userAnchor=8+(anchorPort.clientHeight-16)*.2;
      near(center(),Math.max(8+activeHeight/2,Math.min(anchorPort.clientHeight-8-activeHeight/2,userAnchor)),'user anchor disables automatic lead and targets active voice alone');
      check(p.getEffectiveLayout('NowPlaying').anchor===20&&p.getEffectiveLayout('NowPlaying').before===null,'user anchor and All context remain unchanged');
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),anchor:0});await settle();
      near(voiceTop(earlier),8,'returning to top anchor retargets earlier group without a tick');
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:'default'});await settle();
      near(voiceTop(allGroups[10]),8,'default with All context targets active line alone');
      const pausedTime=time,pausedTicks=clockTicks;
      // No consumer is invoked between these assertions. The mounted renderer
      // must move from the setting event's geometry batch while playback pauses.
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:'max'});await settle();
      near(voiceTop(earlier),8,'switching to Max while paused retargets earlier source');
      check(active.getBoundingClientRect().top>=earlier.querySelector('.Vocals').getBoundingClientRect().bottom,'paused Max leaves active line below previous source');
      check(time===pausedTime&&clockTicks===pausedTicks,'paused height change requires no playback tick');
      p.saveContextAppearance('NowPlaying',{...p.getContextAppearance('NowPlaying'),mode:'hide'});
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),before:0});await settle();
      near(voiceTop(earlier),8,'zero Lines before exposes the automatic lead group live');
      check(allGroups[8].classList.contains('ContextExcluded'),'zero Lines before shows only the effective one earlier group');
      await tick(1.5);near(card.querySelector('.simplebar-content-wrapper').scrollTop,0,'first line stays at clamped start with existing spacers');
      for(const index of [18,19]) {
        await tick(1.5+index*4);const port=card.querySelector('.simplebar-content-wrapper'),maximum=port.scrollHeight-port.clientHeight;
        near(port.scrollTop,maximum,'last lines reach clamped maximum');check(port.scrollTop<=maximum,'never scroll beyond end');
      }
      await tick(41.5);
      p.saveCues('NowPlaying',{threshold:1,motion:false,lastSeconds:null});await settle();
      await tick(43.5);
      check([...card.querySelectorAll('.Interlude')].some(cue=>!cue.closest('.VocalsGroup').hidden),'gap cue is mounted and visible');
      near(voiceTop(allGroups[10]),8,'gap cue keeps its earlier source group at readable top');
      p.saveCues('NowPlaying',{threshold:0,motion:false,lastSeconds:null});await tick(41.5);
      p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:'default'});await settle();
      near(center(),defaultCenter,'switching back restores top anchor');check(earlier.classList.contains('ContextExcluded'),'switching back restores lines before');
      for(const [value,ratio] of [['default',.25],['extended',.40],['max',.51]]) {
        host.style.height='400px';p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),cardHeight:value});await settle();
        near(card.querySelector('.ContentContainer').getBoundingClientRect().height,400*ratio,'short windows use cqh without minimum');
      }
      host.style.height='1400px';
      const tall=source();tall.Content[9].Text='Very tall previous source group '.repeat(80);
      card=await mount(tall);
      const tallGroups=[...card.querySelectorAll('.VocalsGroup')].filter(group=>!group.querySelector('.Interlude'));
      const tallPort=card.querySelector('.simplebar-content-wrapper'),previous=tallGroups[9].querySelector('.Vocals').getBoundingClientRect(),current=tallGroups[10].querySelector('.Vocals').getBoundingClientRect();
      check(current.bottom-previous.top>tallPort.clientHeight-16,'union is taller than usable viewport');
      near(current.top-tallPort.getBoundingClientRect().top,8,'oversized union falls back to active line at readable top');
      check(!host.querySelector('.BL-Attribution'),'renderer creates no old box');
      const panel=document.createElement('div');panel.style.cssText='width:760px;height:500px;overflow:auto';document.body.append(panel);panel.append(host);
      const scrollTo=Element.prototype.scrollTo,writes=[];
      Element.prototype.scrollTo=function(options){if(this===tallPort)writes.push(options);return scrollTo.call(this,options)};
      try {
        panel.scrollTop=800;await settle();
        check(card.isConnected&&consumers.size===0,'clipped mounted card releases its clock');
        const before=writes.length;
        p.saveLayout('NowPlaying',{...p.getLayout('NowPlaying'),transition:'smooth',before:1});
        await tick(21.5);
        check(writes.length===before&&tallGroups[5].classList.contains('ContextExcluded'),'hidden seek and settings do not move or change context');
        panel.scrollTop=0;await settle();
        check(consumers.size===1&&tallGroups[5].querySelector('.Vocals').classList.contains('Active'),'reveal resumes at the current line');
        check(!tallGroups[4].inert&&tallGroups[3].inert,'reveal applies latest context settings');
        check(writes.length>before&&writes.slice(before).every(write=>write.behavior==='instant'),'reveal snaps even with Smooth follow');
        panel.scrollTop=800;await settle();
        check(consumers.size===0,'second hide releases the subscription');
        const oldCard=card,next=source();
        next.Content[7].Text='Replacement song line';time=29.5;
        card=await mount(next);
        check(!oldCard.isConnected&&consumers.size===0,'song change remounts the clipped card without keeping a clock');
        panel.scrollTop=0;await settle();
        check(consumers.size===1&&card.querySelector('.Vocals.Active')?.textContent.includes('Replacement song line'),'reveal uses the replacement song and current clock');
        panel.scrollTop=800;await settle();
        view.Destroy();panel.scrollTop=0;await settle();check(consumers.size===0,'destroy while hidden cannot resubscribe');
      } finally {Element.prototype.scrollTo=scrollTo;panel.remove()}
      jelTestComplete('CARD_CREDIT_PASS');
    }catch(error){jelTestComplete('CARD_CREDIT_FAIL: '+error.stack)}finally{view?.Destroy();host.remove()}
  })();`;
  const ascii=script.replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const directory=path.resolve(await mkdtemp(path.join(tmpdir(),'jel-card-credit-')));
  try {
    const file=path.join(directory,'fixture.html');
    await writeFile(file,`<!doctype html><body><style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}${css}${cardCSS}</style><script>${ascii.replaceAll('</script','<\\/script')}</script>`);
    assert.equal(await runFocusedFixture(chrome,file,path.join(directory,'profile')),'CARD_CREDIT_PASS');
  }finally{assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-card-credit-'));await rm(directory,{recursive:true,force:true,maxRetries:3})}
});
