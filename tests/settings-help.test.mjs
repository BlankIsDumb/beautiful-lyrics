import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as sass from 'sass';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFocusedFixture } from './chromium-focus-harness.mjs';

const chrome = process.env.CHROME_BIN || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

test('immediate settings preserve four text cases/universal cues and abort on close/replacement/runtime disposal', { skip: !chrome }, async () => {
  const result = await build({ stdin: { contents: `
    export {GetExpireStore,GetMemoryStore} from './Extension/Spices/Spicetify/Services/Cache.ts';
    export {OpenProviderSettings} from './Extension/Source/ProviderControls.ts';
    export {PresentationSettings} from './Extension/Source/PresentationSettings.ts';
    export {TimingSettings} from './Extension/Source/TimingSettings.ts';
    export {OnProviderSettingsChanged,OnBehaviorSettingsChanged,OnRichSyncSettingsChanged,GetRichSyncSettings} from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts';
    export {GlobalMaid} from '@Spices/Spicetify/Services/Session.ts';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'formModule', plugins: [{ name: 'synthetic-host', setup(b) {
      b.onResolve({ filter: /Session\.ts$/ }, () => ({ path: 'session', namespace: 'fixture' }));
      b.onResolve({ filter: /Player\/mod\.ts$/ }, () => ({ path: 'player', namespace: 'fixture' }));
      b.onResolve({ filter: /ProviderSettings\.ts$/ }, () => ({ path: path.resolve('Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts') }));
      b.onResolve({ filter: /LyricsCache\.ts$/ }, () => ({ path: path.resolve('Extension/Spices/Spicetify/Services/Player/LyricsCache.ts') }));
      b.onResolve({ filter: /Icons\.ts$/ }, () => ({ path: 'icons', namespace: 'fixture' }));
      b.onLoad({ filter: /\.scss$/ }, () => ({ contents: '' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'session'
        ? `export const IsDevelopment=false; export const SpotifyInternalFetch={}; export const Spotify={PopupModal:fixtureModal,Tippy:fixtureTippy};
           export const GlobalMaid={items:[],Give(fn){this.items.push(fn);return fn},Destroy(){for(const fn of this.items)fn()}};
           export const OnSpotifyReady=new Promise(()=>{});export const ShowNotification=()=>{throw Error('unexpected notification')};`
        : a.path === 'player' ? `export const SongLyrics=undefined,SongLyricChoices=[],SongChanged={},SongLyricsLoaded={};export const SelectLyricsProvider=()=>{};export const ReloadLyrics=()=>{globalThis.fixtureReloads=(globalThis.fixtureReloads||0)+1};`
        : `export default {LyricsPage:''};` }));
    } }] });
  const css = ["Extension/Source/Stylings/ProviderControls.scss", "Extension/Source/Stylings/TypographyPreview.scss", "Extension/Source/Stylings/Lyrics.scss"].map(file=>sass.compile(file).css).join("\n");
  const script = `window.addEventListener("load", async () => {
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const data=new Map([
      ['JustEnoughLyrics/Timing',JSON.stringify({version:1,offsets:{Shared:.25,NowPlaying:-.5,FullLyrics:1}})],
      ['BeautifulLyricsLocal/SpicyToken','  fixture_original_key  '],
      ['BeautifulLyrics/LyricViews',JSON.stringify({Version:1,Items:{RomanizedLanguages:{Japanese:true}}})],
    ]);
    let storageWrites=0,failStorage=false;
    const localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error("fixture quota failure");storageWrites++;data.set(key,value)},removeItem:key=>data.delete(key)};
    const disk=new Map();
    const caches={keys:async()=>[...disk.keys()],open:async name=>{if(!disk.has(name))disk.set(name,new Map());const entries=disk.get(name);return {keys:async()=>[...entries.keys()],put:async(key,response)=>entries.set(key,await response.text()),delete:async key=>entries.delete(key)}}};
    let fixtureForm;
    const modal=document.createElement('div');
    modal.className='spicetify-popup-container';
    const fixtureModal={display({content}){const scroll=document.createElement('div');scroll.className='spicetify-popup-content';scroll.append(content);modal.replaceChildren(scroll);document.body.append(modal);fixtureForm=content},hide(){modal.remove()}};
    const popups=[];
    // Only the host Tippy service is substituted. Form/settings/help code, native
    // label activation, focus, styles and custom-element disconnection are real
    // Chromium. Assert popup DOM and form submission, not just factory counters.
    const fixtureTippy=(button,props)=>{
      const {popper}=props.render();
      popper.dataset.helpFor=button.getAttribute('aria-describedby');
      check(props.trigger==='mouseenter focus click','hover/focus/click are configured');
      const popup={destroyed:false,state:{isVisible:false},show(){if(!this.destroyed){props.appendTo().append(popper);this.state.isVisible=true}},hide(){popper.remove();this.state.isVisible=false},destroy(){this.destroyed=true;this.hide();for(const name of ['mouseenter','focus','click'])button.removeEventListener(name,show);for(const name of ['mouseleave','blur'])button.removeEventListener(name,hide)}};
      const show=()=>popup.show();
      const hide=()=>popup.hide();
      for(const name of ['mouseenter','focus','click'])button.addEventListener(name,show);
      for(const name of ['mouseleave','blur'])button.addEventListener(name,hide);
      popups.push(popup);return popup;
    };
    ${result.outputFiles[0].text}
    try {
      const {OpenProviderSettings,PresentationSettings,TimingSettings,OnProviderSettingsChanged,OnBehaviorSettingsChanged,OnRichSyncSettingsChanged,GetRichSyncSettings,GlobalMaid}=formModule;
      let sourceEvents=0,demandEvents=0,timingEvents=0,languageEvents=0,renderEvents=0,cueEvents=0;
      OnProviderSettingsChanged(()=>sourceEvents++);OnBehaviorSettingsChanged(()=>demandEvents++);
      TimingSettings.subscribe(()=>timingEvents++);PresentationSettings.subscribe(()=>languageEvents++);
      PresentationSettings.subscribeRendering(()=>renderEvents++);PresentationSettings.subscribeCues(()=>cueEvents++);
      const {GetExpireStore,GetMemoryStore}=formModule;
      for(const name of ['Spotify','Musixmatch','AMLL','LRCLIB','Spicy'])await GetExpireStore('BeautifulLyricsLocal_'+name,1,{Duration:14,Unit:'Days'}).SetItem('x',false);
      await GetExpireStore('Player_TrackInformation',1,{Duration:14,Unit:'Days'}).SetItem('x',{track:'fixture'});
      GetMemoryStore('Transformed',40).SetItem('x','prepared');
      OpenProviderSettings();let form=fixtureForm;
      const change=control=>control.dispatchEvent(new Event('change',{bubbles:true}));
      const type=(control,value)=>{control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}))};
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await frame();
      const sections=[...form.querySelectorAll(':scope > section')];
      check(sections.map(section=>section.querySelector(':scope > h3')?.textContent).join('|')==='Behavior|Timings|Now Playing|Fullscreen|Providers|Lyrics Font|Spicy','top-level section order and centered h3 hierarchy');
      check(sections.every(section=>section.children.length===2&&section.lastElementChild.matches('div.BL-Block')),'each section owns one continuous block');
      check(!form.querySelector('h4,h5'),'obsolete hierarchy headings removed');
      check([...sections[0].querySelectorAll('input,select')].map(input=>input.id).join(',')==='BL-FetchMode,BL-LyricsCache','Behavior contains only fetch and cache');
      check(sections[4].querySelectorAll('input[role=switch]').length===5,'Providers owns five source toggles');
      const fontFamily=form.querySelector('#JEL-FontFamily');
      check(fontFamily.labels[0].textContent==='Font family'&&fontFamily.placeholder==='Spotify font'&&fontFamily.closest('section')===sections[5],'font field label, placeholder and section');
      check(form.querySelector('#BL-SpicyToken').placeholder==='Client token'&&form.querySelector('#BL-SpicyToken').closest('section')===sections[6],'Spicy field placeholder and section');
      for(const description of form.querySelectorAll('.BL-HelpDescription'))check(!/\\b(?:you|your|Comfy)\\b/i.test(description.textContent),'all help avoids second person and theme references: '+description.textContent);
      for(const view of ['NowPlaying','FullLyrics']) {
        const section=form.querySelector('#JEL-'+view+'-Heading').parentElement,block=section.lastElementChild,fields=form.querySelector('#JEL-'+view+'-Options');
        check(section.matches('section.BL-ViewSettings')&&section.parentElement===form&&section.getAttribute('aria-labelledby')==='JEL-'+view+'-Heading'&&section.firstElementChild.tagName==='H3','top-level accessible view section '+view);
        check([...fields.children].filter(element=>element.matches('details')).map(details=>details.querySelector('summary').textContent).join('|')==='Background|Typography|Context|Scrolling|Gap dots|Word sync|Line sync|Conversions','view group order '+view);
        const dots=form.querySelector('#JEL-'+view+'-GapThreshold').closest('details');
        check(dots.querySelector('summary').textContent==='Gap dots'&&[...dots.querySelectorAll('input')].map(input=>input.id).join(',')==='JEL-'+view+'-GapThreshold,JEL-'+view+'-CueMotion,JEL-'+view+'-CueLastSeconds','Gap dots owns three existing ids '+view);
        check(!fields.querySelector('[id$="-TimingOffset"]'),'view options contain no offset '+view);
        if(view==='NowPlaying')check(block.firstElementChild.matches('.BL-HelpRow.BL-GroupHeader')&&block.firstElementChild.querySelector('#BL-SidebarEnabled')&&block.children.length===2&&fields.previousElementSibling===block.firstElementChild,'Enabled is first row in the same block as options');
        else check(block.firstElementChild===fields&&!block.querySelector('.BL-GroupHeader')&&fields.firstElementChild.querySelector('summary').textContent==='Background','Fullscreen block starts with groups and has no band');
      }
      const helpText=id=>form.querySelector(id).closest('.BL-HelpRow').querySelector('.BL-HelpDescription').textContent;
      check(helpText('#BL-FetchMode')==='On song change loads lyrics as each song starts. When required waits until a view shows lyrics. Now Playing counts while enabled. Classic: On song change','fetch help');
      check(helpText('#BL-LyricsCache')==='Clears saved lyrics for one provider, or All. All also clears track details and provider cooldowns. Tokens stay saved. The current song reloads.','cache help has no footer');
      check(helpText('#JEL-FullLyrics-TimingOffset')==='Added to Lyric delay in Fullscreen only. Classic: 0 s','Fullscreen offset help');
      check(helpText('#JEL-FullLyrics-Layout-leading').endsWith('Classic: 1.18')&&helpText('#JEL-FullLyrics-Layout-groupGap').endsWith('Classic: Original'),'typography Classic footers');
      // Open native groups before measuring: closed details intentionally have no
      // row boxes. Use the real modal width, styles and Chromium layout engine.
      form.querySelectorAll('details').forEach(details=>details.open=true);
      const nearLayout=(actual,expected,message)=>check(Math.abs(actual-expected)<=1,message+' '+actual+' / '+expected);
      const visibleLayout=element=>element.getClientRects().length>0&&getComputedStyle(element).display!=='none';
      const bandDepth=element=>{let depth=0;for(let parent=element.parentElement;parent&&!parent.matches('.BL-Block');parent=parent.parentElement)if(parent.matches('.BL-GroupOptions:not(.BL-ReadingStyle)'))depth++;return depth;};
      for(const band of form.querySelectorAll('.BL-GroupOptions'))if(visibleLayout(band)) {
        const bounds=band.getBoundingClientRect(),block=band.closest('.BL-Block').getBoundingClientRect(),style=getComputedStyle(band);
        nearLayout(bounds.left,block.left,'band starts at block left');nearLayout(bounds.right,block.right,'band ends at block right');nearLayout(bounds.width,block.width,'band fills block width');
        for(const property of ['paddingLeft','paddingRight','marginLeft','marginRight'])nearLayout(parseFloat(style[property]),0,'band has no horizontal inset '+property);
        check(style.backgroundColor===(band.matches('.BL-ReadingStyle')?'rgba(0, 0, 0, 0)':'rgba(0, 0, 0, 0.15)'),'only real depth bands add shade');
      }
      const measuredDepths=new Set();
      for(const row of form.querySelectorAll('.BL-Block .BL-HelpRow,.BL-Block details > summary,.BL-Block .BL-ButtonRow,.BL-Block p'))if(visibleLayout(row)) {
        const depth=bandDepth(row),leftInset=16+16*depth,style=getComputedStyle(row),bounds=row.getBoundingClientRect(),block=row.closest('.BL-Block').getBoundingClientRect();
        nearLayout(parseFloat(style.paddingLeft),leftInset,'row content inset at depth '+depth);nearLayout(parseFloat(style.paddingRight),16,'right inset stays fixed at depth '+depth);
        if(row.matches('.BL-HelpRow')) {
          measuredDepths.add(depth);nearLayout(row.querySelector('label').getBoundingClientRect().left-block.left,leftInset,'label inset at depth '+depth);
          const controls=row.querySelectorAll(':scope > input:not([type=range]),:scope > select,:scope > button:not(.BL-HelpButton)');
          nearLayout(block.right-controls[controls.length-1].getBoundingClientRect().right,16,'trailing control aligns across depths');
          nearLayout(bounds.height,row.matches('.BL-HorizontalSpacing')?104:row.matches('.BL-TokenTile')||row.querySelector(':scope > output')?88:56,'row height stays fixed at depth '+depth);
        } else if(row.matches('.BL-ButtonRow'))nearLayout(block.right-row.lastElementChild.getBoundingClientRect().right,16,'group buttons share the control right edge');
      }
      check([0,1,2,3].every(depth=>measuredDepths.has(depth)),'measured real controls at depths zero through three');
      const lastSection=sections.at(-1),lastBlock=lastSection.querySelector(':scope > .BL-Block');
      nearLayout(lastSection.getBoundingClientRect().bottom-lastBlock.getBoundingClientRect().bottom,28,'last block has 28px bottom space before footer');
      nearLayout(parseFloat(getComputedStyle(lastSection).paddingBottom),parseFloat(getComputedStyle(sections[1].querySelector('h3')).marginTop),'bottom space matches section gap');
      const ordinary=['#BL-SidebarEnabled','#BL-FetchMode','#JEL-Shared-TimingOffset','#JEL-FontFamily'].map(id=>form.querySelector(id).closest('.BL-HelpRow'));
      const heights=ordinary.map(row=>row.getBoundingClientRect().height);
      check(heights.every(height=>Math.abs(height-56)<=1)&&Math.max(...heights)-Math.min(...heights)<=1,'switch/select/number/text rows share 56px height: '+heights.join(','));
      check(ordinary.every(row=>getComputedStyle(row).backgroundColor==='rgba(0, 0, 0, 0)'||row.classList.contains('BL-GroupHeader')),'ordinary rows have no card background');
      const twoLine=['#BL-SpicyToken',...['NowPlaying','FullLyrics'].flatMap(view=>['primaryRatio','backingRatio'].map(key=>'#JEL-'+view+'-Layout-'+key))].map(id=>form.querySelector(id).closest('.BL-HelpRow'));
      check(twoLine.every(row=>Math.abs(row.getBoundingClientRect().height-88)<=1),'size readout and token rows are 88px');
      const spacingRows=[...form.querySelectorAll('.BL-HorizontalSpacing')];
      check(spacingRows.length===3&&spacingRows.every(row=>Math.abs(row.getBoundingClientRect().height-104)<=1),'all three spacing rows are 104px');
      for(const row of [...twoLine,...spacingRows]) {
        const label=row.querySelector('label').getBoundingClientRect(),help=row.querySelector('.BL-HelpButton').getBoundingClientRect(),bounds=row.getBoundingClientRect();
        check(Math.abs(help.left-label.right-12)<=1&&Math.abs((help.top+help.bottom-label.top-label.bottom)/2)<=1,'readout/token help stays adjacent to label on line one');
        const second=row.querySelector('output,input[type=password]').getBoundingClientRect();
        check(second.top>=help.bottom&&bounds.bottom-second.bottom<=20,'second/last line fits without an empty band');
        const number=row.querySelector('input[type=number]');
        if(number){const rect=number.getBoundingClientRect();check(Math.abs(rect.top-help.top)<=1&&Math.abs(rect.right-(bounds.right-16))<=1,'number stays right-aligned on line one');}
        else {const rect=row.querySelector('input[type=password]').getBoundingClientRect();check(Math.abs(rect.left-(bounds.left+16))<=1&&Math.abs(rect.right-(bounds.right-16))<=1,'token input fills line two');}
        const slider=row.querySelector('input[type=range]');if(slider){const rect=slider.getBoundingClientRect();check(rect.top>=help.bottom&&rect.bottom<=second.top,'slider occupies line two before readout');}
      }
      const statusLine=form.querySelector('p[role=status]');
      check(getComputedStyle(statusLine).display==='none','empty status is hidden');statusLine.textContent='Applied.';
      check(getComputedStyle(statusLine).position==='sticky'&&getComputedStyle(statusLine).bottom==='0px','status is a sticky footer');statusLine.textContent='';
      for(const fields of form.querySelectorAll('.BL-GroupOptions')) {
        const buttons=fields.querySelector(':scope > .BL-ButtonRow');if(buttons)check(buttons===fields.lastElementChild,'group buttons stay at the end');
      }
      form.querySelectorAll('details').forEach(details=>details.open=false);
      const cacheScope=form.querySelector('#BL-LyricsCache'),clearCache=form.querySelector('#BL-ClearLyricsCache');
      check(cacheScope.options[0].textContent==='All (7)'&&cacheScope.options[5].textContent==='Spicy (1)','open computes disk Spicy counts and label');
      cacheScope.value='Spotify';clearCache.click();check(clearCache.disabled&&cacheScope.disabled,'clear rejects duplicate clicks');
      await frame();check(globalThis.fixtureReloads===1&&cacheScope.options[1].textContent==='Spotify (0)'&&form.querySelector('[role=status]').textContent==='Removed 1 cache entry.','provider clear refreshes counts/status and reloads once');
      cacheScope.value='All';clearCache.click();await frame();check(globalThis.fixtureReloads===2&&cacheScope.options[0].textContent==='All (0)'&&form.querySelector('[role=status]').textContent==='Removed 6 cache entries.'&&data.get('BeautifulLyricsLocal/SpicyToken')==='  fixture_original_key  ','All clears memory/metadata and preserves raw token bytes');
      const background=(view,key)=>form.querySelector('#JEL-'+view+'-Background-'+key);
      const backgroundEvents=[];const stopBackground=PresentationSettings.subscribeBackground((view,fields)=>backgroundEvents.push([view,fields]));
      for(const view of ['NowPlaying','FullLyrics']) {
        const mode=background(view,'mode'),motion=background(view,'motion'),brightness=background(view,'brightness'),paused=background(view,'paused'),fps=background(view,'fps'),resolution=background(view,'resolution');
        check(mode.value===(view==='NowPlaying'?'off':'animated'),'per-view background defaults');
        check(brightness.step==='5'&&brightness.min==='50'&&brightness.max==='150','background brightness bounds');
        check(!mode.matches(':disabled')&&brightness.matches(':disabled')===(view==='NowPlaying'),'Off disables amounts');
        check(helpText('#JEL-'+view+'-Background-mode')==='Animated moves the artwork gradient. Static draws it once. Off removes it. Classic: Animated','background help');
        mode.value='static';change(mode);check(motion.matches(':disabled')&&paused.matches(':disabled')&&fps.matches(':disabled')&&!brightness.matches(':disabled')&&!resolution.matches(':disabled'),'Static disables motion controls only');
        type(brightness,'125');resolution.value='quarter';change(resolution);
        motion.value='fast';change(motion);check(PresentationSettings.getBackground(view).motion==='classic','disabled background event ignored');
        mode.value='animated';change(mode);fps.value='60';change(fps);
        const group=mode.closest('fieldset');[...group.querySelectorAll('button')].find(b=>b.textContent==='Classic background').click();
        const classic=PresentationSettings.getBackground(view);check(classic.mode==='animated'&&classic.motion==='classic'&&classic.brightness===100&&classic.paused==='animate'&&classic.fps==='60'&&classic.resolution==='quarter','Classic restores look and keeps quality');
        failStorage=true;mode.value='off';change(mode);failStorage=false;check(mode.value==='animated','failed background save restores UI');
        [...group.querySelectorAll('button')].find(b=>b.textContent==='Reset background').click();check(mode.value===(view==='NowPlaying'?'off':'animated')&&fps.value==='30'&&resolution.value==='half'&&paused.value==='freeze','per-view reset');
      }
      check(backgroundEvents.length>0&&sourceEvents===0&&demandEvents===0&&languageEvents===0&&renderEvents===0&&cueEvents===0,'background saves isolated from lyrics/providers');stopBackground();
      const spacing=surface=>form.querySelector('#JEL-'+surface+'-HorizontalSpacing');
      const spacingNumber=surface=>form.querySelector('#JEL-'+surface+'-HorizontalSpacing-Number');
      check(form.querySelectorAll('input[type=range]').length===3,'one horizontal slider per surface');
      check(!form.querySelector('[id$="-Layout-inset"]'),'obsolete pixel inset removed');
      const untouched=JSON.stringify([...data]),untouchedWrites=storageWrites;
      for(let value=1;value<=30;value++)type(spacing('Contained'),String(value));
      check(PresentationSettings.getEffectiveHorizontalSpacing('Contained')===30&&PresentationSettings.getHorizontalSpacing('Contained')===0,'drag previews without changing canonical spacing');
      check(PresentationSettings.getEffectiveHorizontalSpacing('Fullscreen')===0&&PresentationSettings.getEffectiveHorizontalSpacing('Card')===0,'preview is surface specific');
      check(storageWrites===untouchedWrites&&JSON.stringify([...data])===untouched,'drag has zero storage writes');
      check(spacingNumber('Contained').value==='30','range synchronizes number');
      spacing('Contained').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      check(PresentationSettings.getEffectiveHorizontalSpacing('Contained')===0&&spacingNumber('Contained').value==='0','Escape cancels draft');
      type(spacingNumber('Contained'),'-27');check(spacing('Contained').value==='-27','number synchronizes range');change(spacingNumber('Contained'));
      check(PresentationSettings.getHorizontalSpacing('Contained')===-27&&storageWrites===untouchedWrites+1,'confirmed number saves once');
      const confirmedWrites=storageWrites;
      for(const invalid of ['','101','1.5'])type(spacingNumber('Contained'),invalid);
      check(storageWrites===confirmedWrites&&PresentationSettings.getEffectiveHorizontalSpacing('Contained')===-27,'invalid spacing never previews or writes');
      spacingNumber('Contained').dispatchEvent(new FocusEvent('blur'));check(spacingNumber('Contained').value==='-27','invalid spacing blur restores saved');
      type(spacing('Fullscreen'),'44');change(spacing('Fullscreen'));type(spacing('Card'),'12');change(spacing('Card'));
      const fullTypography=spacing('Fullscreen').closest('fieldset');
      type(spacing('Fullscreen'),'70');
      [...fullTypography.querySelectorAll('button')].find(button=>button.textContent==='Classic typography').click();
      check(PresentationSettings.getHorizontalSpacing('Contained')===0&&PresentationSettings.getHorizontalSpacing('Fullscreen')===0&&PresentationSettings.getEffectiveHorizontalSpacing('Fullscreen')===0,'typography reset cancels previews and resets both associated page surfaces');
      check(PresentationSettings.getHorizontalSpacing('Card')===12,'FullLyrics reset leaves Card spacing alone');
      const cardRow=spacing('Card').closest('.BL-HorizontalSpacing');
      [...cardRow.closest('fieldset').querySelectorAll('.BL-ButtonRow button')].find(button=>button.textContent==='Reset sidecard spacing').click();
      check(PresentationSettings.getHorizontalSpacing('Card')===0,'per-surface reset');
      const beforeFailure=JSON.stringify([...data]);type(spacing('Contained'),'55');failStorage=true;change(spacing('Contained'));failStorage=false;
      check(JSON.stringify([...data])===beforeFailure&&PresentationSettings.getHorizontalSpacing('Contained')===0&&PresentationSettings.getEffectiveHorizontalSpacing('Contained')===0&&spacingNumber('Contained').value==='0','failed commit restores canonical spacing and controls');
      const outside=(view,key)=>form.querySelector('#JEL-'+view+'-Context-'+key);
      const contextMode=outside('FullLyrics','mode'),contextBlur=outside('FullLyrics','blur'),contextDark=outside('FullLyrics','darkening'),contextOpacity=outside('FullLyrics','opacity');
      check(contextMode.value==='hide'&&contextBlur.matches(':disabled')&&contextOpacity.matches(':disabled'),'Hide initially disables remembered appearance controls');
      const hiddenAppearance=JSON.stringify([...data]);type(contextBlur,'4');check(JSON.stringify([...data])===hiddenAppearance,'Hide rejects late synthetic appearance input');
      contextMode.value='muted';change(contextMode);
      check(!contextBlur.matches(':disabled')&&!contextOpacity.matches(':disabled')&&contextBlur.value==='2','muted restores remembered appearance controls');
      check(contextBlur.step==='0.25'&&contextBlur.max==='12'&&contextDark.step==='1'&&contextOpacity.max==='100','appearance controls declare exact units and bounds');
      type(contextBlur,'3.25');type(contextDark,'72');type(contextOpacity,'48');
      check(PresentationSettings.getContextAppearance('FullLyrics').blur===3.25&&PresentationSettings.getContextAppearance('FullLyrics').darkening===72&&PresentationSettings.getContextAppearance('FullLyrics').opacity===48,'independent appearance amounts apply immediately');
      check(PresentationSettings.getContextAppearance('NowPlaying').mode==='hide'&&outside('NowPlaying','opacity').value==='35','appearance profiles remain isolated');
      outside('FullLyrics','blurEnabled').click();
      check(contextBlur.matches(':disabled')&&!contextDark.matches(':disabled')&&!contextOpacity.matches(':disabled'),'blur toggle disables only its own amount');
      outside('FullLyrics','darkeningEnabled').click();
      check(contextDark.matches(':disabled')&&!contextOpacity.matches(':disabled'),'darkening is independent of opacity');
      const disabledAppearance=JSON.stringify([...data]);type(contextBlur,'6');type(contextDark,'10');check(JSON.stringify([...data])===disabledAppearance,'disabled effects reject synthetic edits');
      outside('FullLyrics','blurEnabled').click();outside('FullLyrics','darkeningEnabled').click();
      check(contextBlur.value==='3.25'&&contextDark.value==='72','disabled effect amounts are remembered');
      const validAppearance=JSON.stringify([...data]);for(const invalid of ['','12.25','-0.25','0.1'])type(contextBlur,invalid);
      check(JSON.stringify([...data])===validAppearance,'invalid blur and fractional step do not persist');contextBlur.dispatchEvent(new FocusEvent('blur'));check(contextBlur.value==='3.25','invalid appearance edit restores saved amount');
      for(const invalid of ['','101','-1','1.5'])type(contextOpacity,invalid);
      check(JSON.stringify([...data])===validAppearance,'invalid opacity never persists');contextOpacity.dispatchEvent(new FocusEvent('blur'));
      type(contextOpacity,'0');check(PresentationSettings.getContextAppearance('FullLyrics').opacity===0,'zero opacity is accepted');type(contextOpacity,'48');
      contextMode.value='hide';change(contextMode);contextMode.value='muted';change(contextMode);
      check(contextBlur.value==='3.25'&&contextOpacity.value==='48','Hide retains customized amounts');
      const beforeControlFailure=JSON.stringify([...data]);failStorage=true;contextMode.value='hide';change(contextMode);failStorage=false;
      check(JSON.stringify([...data])===beforeControlFailure&&contextMode.value==='muted'&&!contextOpacity.matches(':disabled'),'failed mode save restores enabled state');
      const beforeCount=form.querySelector('#JEL-FullLyrics-Layout-before'),afterCount=form.querySelector('#JEL-FullLyrics-Layout-after');type(beforeCount,'1');type(afterCount,'2');
      const preservedLayout=PresentationSettings.getLayout('FullLyrics'),preservedRendering=JSON.stringify(PresentationSettings.getRendering('FullLyrics','Word')),resetWrites=storageWrites;
      const contextBody=contextMode.closest('details');[...contextBody.querySelectorAll('button')].find(button=>button.textContent==='Reset context').click();
      check(storageWrites===resetWrites+1&&beforeCount.value===''&&afterCount.value===''&&contextMode.value==='hide','Context reset is one save for counts and appearance');
      check(contextBlur.value==='2'&&contextDark.value==='60'&&contextOpacity.value==='35'&&contextBlur.matches(':disabled'),'Context reset restores appearance defaults and disabling');
      check(PresentationSettings.getLayout('FullLyrics').primaryRatio===preservedLayout.primaryRatio&&PresentationSettings.getLayout('FullLyrics').anchor===preservedLayout.anchor&&JSON.stringify(PresentationSettings.getRendering('FullLyrics','Word'))===preservedRendering,'Context reset preserves typography scrolling and effects');
      check(sourceEvents===0&&demandEvents===0&&renderEvents===0,'appearance changes never invalidate provider or text rendering profiles');
      const anchor=form.querySelector('#JEL-FullLyrics-Layout-anchor');
      check(anchor.required&&anchor.step==='any','anchor is required and accepts fractional percentages');
      type(anchor,'34.125');check(PresentationSettings.getLayout('FullLyrics').anchor===34.125,'fractional anchor retained');
      const beforeBlank=JSON.stringify([...data]);type(anchor,'');check(JSON.stringify([...data])===beforeBlank,'empty anchor does not save legacy mode');anchor.dispatchEvent(new FocusEvent('blur'));check(anchor.value==='34.125','empty anchor blur restores exact percentage');
      type(anchor,'45');
      check(!form.querySelector('button[type=submit]'),'no Save button');
      check(![...form.querySelectorAll('h3')].some(h=>h.textContent==='Lyrics'),'old Lyrics wrapper removed');
      check(form.querySelectorAll('.BL-ViewOptions > details.BL-CaseSettings[id$="-Settings"]').length===4,'four native collapsible source cases');
      for(const view of ['NowPlaying','FullLyrics']){
        check(!form.querySelector('#JEL-'+view+'-Line-TextDetail')&&!form.querySelector('#JEL-'+view+'-Line-verticalMotion')&&!form.querySelector('#JEL-'+view+'-Line-emphasis'),'Line case omits unsupported word capabilities');
        check(form.querySelector('#JEL-'+view+'-CueMotion')&&!form.querySelector('#JEL-'+view+'-Word-cueAnimation'),'cue options view-wide only');
      }
      const shared=form.querySelector('#JEL-Shared-TimingOffset'),full=form.querySelector('#JEL-FullLyrics-TimingOffset');
      check([shared,full,form.querySelector('#JEL-NowPlaying-TimingOffset')].every(input=>input.closest('section')===sections[1]),'all offsets under Timings');
      const hold=form.querySelector('#BL-RichSyncHoldSeconds'),holdWord=form.querySelector('#BL-RichSyncHoldWordSync'),minimum=form.querySelector('#BL-RichSyncMinimumSegments');
      check(hold.value==='5'&&minimum.value==='2'&&holdWord.checked&&hold.closest('section')===sections[1],'rich-sync fields default to 5, 2 and On under Timings');
      check(hold.step==='0.1'&&minimum.step==='0.1'&&hold.min==='0'&&minimum.min==='0'&&!hold.hasAttribute('max')&&!minimum.hasAttribute('max'),'rich-sync numbers use 0.1 steps with zero minimum and no maximum');
      const holdGroup=hold.closest('details.BL-CaseSettings'),holdOptions=hold.closest('fieldset.BL-GroupOptions');
      check(holdGroup&&holdGroup.previousElementSibling.contains(full)&&holdGroup.querySelector('summary').textContent==='Hold highlight across gaps','hold group follows all three offsets');
      check(!holdGroup.open&&holdGroup.children[0].tagName==='SUMMARY'&&holdOptions.parentElement===holdGroup,'native collapsible group uses summary then options fieldset');
      check(holdWord.closest('fieldset')===holdOptions&&[...holdOptions.querySelectorAll('input')].map(input=>input.id).join(',')==='BL-RichSyncHoldSeconds,BL-RichSyncHoldWordSync','gap limit precedes word toggle inside group');
      check(hold.getAttribute('aria-label')==='Gap limit (s)'&&holdWord.getAttribute('role')==='switch'&&holdWord.getAttribute('aria-label')==='Apply to word sync','labels and toggle semantics');
      check(minimum.closest('.BL-HelpRow').previousElementSibling===holdGroup&&!minimum.closest('details'),'minimum stays after and outside the hold group');
      holdGroup.open=true;
      let richSyncEvents=0;
      OnRichSyncSettingsChanged(()=>richSyncEvents++);
      holdWord.click();
      check(!holdWord.checked&&!GetRichSyncSettings().holdWordSync&&richSyncEvents===1,'toggle Off persists and publishes immediately');
      type(hold,'3.5');
      check(GetRichSyncSettings().holdSeconds===3.5&&!GetRichSyncSettings().holdWordSync&&richSyncEvents===2,'number edits preserve the toggle');
      holdWord.click();
      check(holdWord.checked&&GetRichSyncSettings().holdWordSync&&richSyncEvents===3,'toggle On persists immediately');
      failStorage=true;holdWord.click();failStorage=false;
      check(holdWord.checked&&GetRichSyncSettings().holdWordSync&&richSyncEvents===3,'failed toggle write restores checkbox without publishing');
      holdOptions.disabled=true;const disabledBytes=JSON.stringify([...data]);holdWord.checked=false;change(holdWord);
      check(JSON.stringify([...data])===disabledBytes&&richSyncEvents===3,'inherited disabled fieldset blocks toggle writes');
      holdOptions.disabled=false;holdWord.checked=GetRichSyncSettings().holdWordSync;
      const wordHelp=holdWord.previousElementSibling;wordHelp.dispatchEvent(new MouseEvent('mouseenter'));
      const wordHelpText=document.querySelector('.BL-SettingsHelpPopup')?.textContent;
      check(wordHelpText==='Off holds line-synced lyrics only. On also holds word-synced lyrics.Classic: On','toggle help explains both modes');
      wordHelp.dispatchEvent(new MouseEvent('mouseleave'));
      for(const field of [hold,minimum]) {
        const help=field.previousElementSibling;
        help.dispatchEvent(new MouseEvent('mouseenter'));
        const text=document.querySelector('.BL-SettingsHelpPopup')?.textContent;
        check(text?.includes('Musixmatch, LRCLIB and Spotify only.')&&text.includes('0 turns')&&!text.includes('Classic:')&&!/\\b(?:you|your|Comfy)\\b/i.test(text),'rich-sync help explains eligible providers and zero gate without a footer');
        help.dispatchEvent(new MouseEvent('mouseleave'));
        type(field,'0');check(field.value==='0','zero is accepted by both fields');
      }
      check(sourceEvents===0&&demandEvents===0,'compensation settings do not publish source or demand reload events');
      const wordPreset=form.querySelector('#JEL-FullLyrics-Word-TextPreset'),wordGlow=form.querySelector('#JEL-FullLyrics-Word-glow');
      form.querySelector('#JEL-FullLyrics-Word-Settings').open=true;
      const help=wordPreset.previousElementSibling,label=wordPreset.labels[0];
      check(!help.closest('label')&&help.previousElementSibling===label,'help title-adjacent sibling');
      let nativeFocusEvents=0;help.addEventListener('focus',event=>{if(event.isTrusted)nativeFocusEvents++});
      const diagnostics=()=>JSON.stringify({documentFocused:document.hasFocus(),nativeFocusEvents,activeIsHelp:document.activeElement===help,active:document.activeElement?.tagName,activeId:document.activeElement?.id,helpTag:help.tagName,helpDisabled:help.disabled,disabledMatch:help.matches(':disabled'),formConnected:form.isConnected,detailsOpen:help.closest('details')?.open,rect:{width:help.getBoundingClientRect().width,height:help.getBoundingClientRect().height},popupCount:popups.length,destroyed:popups.filter(p=>p.destroyed).length,visible:popups.filter(p=>p.state.isVisible).length});
      const a=label.getBoundingClientRect(),b=help.getBoundingClientRect();check(a.width>0&&a.height>0&&b.width>0&&b.height>0,'positive title/help geometry '+diagnostics());check(b.left>=a.right&&b.left-a.right<=13,'title/help geometry '+diagnostics());
      const rawBefore=JSON.stringify([...data]);help.focus();
      check(document.activeElement===help&&nativeFocusEvents>0&&document.querySelector('.BL-SettingsHelpPopup'),'focus help opens '+diagnostics());
      let escapes=0;form.addEventListener('keydown',()=>escapes++);
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(!document.querySelector('.BL-SettingsHelpPopup')&&escapes===0,'first Escape hides tooltip only');
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(escapes===1,'second Escape reaches modal');
      help.dispatchEvent(new MouseEvent('mouseenter'));check(document.querySelector('.BL-SettingsHelpPopup'),'hover help opens');
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));help.click();
      const popup=[...document.querySelectorAll('.BL-SettingsHelpPopup')].find(p=>p.dataset.helpFor===help.getAttribute('aria-describedby'));
      check(popup.lastElementChild.textContent==='Classic: Classic','Classic footer last');
      check(rawBefore===JSON.stringify([...data])&&sourceEvents===0&&renderEvents===0,'help writes nothing');
      wordPreset.value='minimal';change(wordPreset);
      check(PresentationSettings.getRendering('FullLyrics','Word').preset==='minimal'&&renderEvents===1,'preset applies without Save once');
      check(PresentationSettings.getCues('FullLyrics').motion&&cueEvents===0,'text preset never changes universal dots');
      const glowBefore=wordGlow.checked;wordGlow.previousElementSibling.click();check(wordGlow.checked===glowBefore,'help never toggles switch');
      const gr=wordGlow.getBoundingClientRect(),rr=wordGlow.parentElement.getBoundingClientRect();check(Math.abs(gr.right-(rr.right-parseFloat(getComputedStyle(wordGlow.parentElement).paddingRight)))<=1,'effect switch right edge');
      wordGlow.click();check(PresentationSettings.getRendering('FullLyrics','Word').glow&&wordPreset.value==='custom','independent effect immediate Custom');
      check(PresentationSettings.getRendering('FullLyrics','Line').preset==='balanced'&&PresentationSettings.getRendering('NowPlaying','Word').preset==='classic','three other cases retained');
      const gap=form.querySelector('#JEL-FullLyrics-GapThreshold');type(gap,'100');
      check(PresentationSettings.getCues('FullLyrics').threshold===100&&cueEvents===1,'100 means100 seconds immediate');
      type(gap,'0');check(PresentationSettings.getCues('FullLyrics').threshold===0,'0 disables dots');
      const stable=JSON.stringify([...data]);for(const invalid of ['', '-1'])type(gap,invalid);
      check(JSON.stringify([...data])===stable,'partial/negative threshold never persisted');gap.dispatchEvent(new FocusEvent('blur'));check(gap.value==='0','invalid blur restores committed value');
      const cueWindow=form.querySelector('#JEL-FullLyrics-CueLastSeconds');
      check(cueWindow.value===''&&cueWindow.placeholder==='Full'&&helpText('#JEL-FullLyrics-CueLastSeconds').endsWith('Classic: Full gap'),'blank cue window uses compact placeholder and keeps Full gap footer');
      type(cueWindow,'0.125');
      check(PresentationSettings.getCues('FullLyrics').lastSeconds===.125&&PresentationSettings.getCues('FullLyrics').threshold===0&&PresentationSettings.getCues('NowPlaying').lastSeconds===null,'fractional window is saved while cues are off, within its viewer');
      const windowBytes=JSON.stringify([...data]);
      for(const invalid of ['0','-2'])type(cueWindow,invalid);
      check(cueWindow.getAttribute('aria-invalid')==='true'&&JSON.stringify([...data])===windowBytes,'nonpositive cue window leaves the prior setting active');
      cueWindow.dispatchEvent(new FocusEvent('blur'));
      check(cueWindow.value==='0.125'&&!cueWindow.hasAttribute('aria-invalid'),'invalid window blur restores the saved value');
      failStorage=true;type(cueWindow,'2');failStorage=false;
      check(cueWindow.value==='0.125'&&JSON.stringify([...data])===windowBytes,'failed cue-window save restores the input');
      type(cueWindow,'');check(PresentationSettings.getCues('FullLyrics').lastSeconds===null,'clearing the window saves full gap');

      const wordEasing=form.querySelector('#JEL-FullLyrics-Word-AnimationEasing');
      const wordDetail=form.querySelector('#JEL-FullLyrics-Word-TextDetail');
      const lineResponse=form.querySelector('#JEL-FullLyrics-Line-AnimationResponse');
      wordEasing.value='ease-in';change(wordEasing);
      check(PresentationSettings.getRendering('FullLyrics','Word').animationEasing==='ease-in'&&wordPreset.value==='custom','editing Word easing applies immediately and marks the text preset Custom');
      failStorage=true;wordDetail.value='line';change(wordDetail);failStorage=false;
      check(wordDetail.value==='auto'&&!wordPreset.matches(':disabled'),'failed detail save restores Word controls');
      wordDetail.value='line';change(wordDetail);
      check([wordEasing,wordPreset,wordGlow].every(input=>input.closest('[hidden]')&&input.matches(':disabled'))&&!wordDetail.matches(':disabled'),'whole-line display hides and disables Word effects but keeps its detail control');
      wordEasing.value='linear';change(wordEasing);
      check(PresentationSettings.getRendering('FullLyrics','Word').animationEasing==='ease-in','hidden Word dropdown cannot overwrite the remembered choice');
      const lineSettings=form.querySelector('#JEL-FullLyrics-Line-Settings');
      form.querySelector('button[aria-controls="JEL-FullLyrics-Line-Settings"]').click();
      check(lineSettings.open&&document.activeElement===lineSettings.querySelector('summary'),'Line shortcut opens and focuses the viewer’s Line profile');
      lineResponse.closest('details').open=true;
      lineResponse.value='direct';change(lineResponse);
      const lineProfile=PresentationSettings.getRendering('FullLyrics','Line');
      check(lineProfile.animationResponse==='direct'&&!lineProfile.glow&&!lineProfile.scale&&lineProfile.preset==='custom','Line response leaves disabled effects disabled');
      check(PresentationSettings.getRendering('FullLyrics','Word').animationResponse==='classic'&&PresentationSettings.getRendering('NowPlaying','Line').animationResponse==='classic','other stored animation settings stay independent');
      failStorage=true;lineResponse.value='fast';change(lineResponse);failStorage=false;
      check(lineResponse.value==='direct'&&PresentationSettings.getRendering('FullLyrics','Line').animationResponse==='direct','failed response save restores the dropdown');
      wordDetail.value='auto';change(wordDetail);
      check(!wordEasing.closest('[hidden]')&&!wordPreset.matches(':disabled')&&wordEasing.value==='ease-in','returning to Word restores its stored effects');
      const linePreset=form.querySelector('#JEL-FullLyrics-Line-TextPreset');linePreset.value='balanced';change(linePreset);
      check(lineResponse.value==='classic'&&PresentationSettings.getRendering('FullLyrics','Line').animationResponse==='classic','applying a named text preset resets the response');

      type(full,'1.5');check(TimingSettings.get('FullLyrics')===1.5&&TimingSettings.get('Shared')===.25&&TimingSettings.get('NowPlaying')===-.5,'offset applies only its scope');
      const savedOffset=JSON.stringify([...data]);type(full,'');type(full,'31');check(savedOffset===JSON.stringify([...data]),'blank/out-of-range offset ignored');full.dispatchEvent(new FocusEvent('blur'));check(full.value==='1.5','bad offset edit restored');
      const jp=form.querySelector('#JEL-FullLyrics-Japanese-Conversion');jp.value='kana';change(jp);
      check(PresentationSettings.getConversions('FullLyrics').languages.Japanese.kind==='kana'&&PresentationSettings.getRendering('FullLyrics','Word').glow,'conversion preserves text cases');
      let annotationEvents=0;PresentationSettings.subscribeAnnotations(()=>annotationEvents++);
      const placement=form.querySelector('#JEL-FullLyrics-Japanese-Placement');placement.value='above';change(placement);
      const rowSize=form.querySelector('#JEL-FullLyrics-Reading-secondarySize');type(rowSize,'.9');
      check(PresentationSettings.getAnnotations('FullLyrics').secondarySize===.9&&PresentationSettings.getConversions('FullLyrics').languages.Japanese.placement==='above','above and size apply immediately');
      jp.value='furigana';change(jp);check(placement.disabled&&placement.value==='attached','furigana forces attached');
      const beforeHiddenStyle=JSON.stringify([...data]);type(rowSize,'1.1');check(beforeHiddenStyle===JSON.stringify([...data]),'hidden row style is disabled');
      jp.value='romaji';change(jp);check(placement.value==='above'&&!placement.disabled,'format restores remembered row placement');
      jp.value='furigana';change(jp);
      for(const view of ['NowPlaying','FullLyrics']) {
        const conversion=form.querySelector('#JEL-'+view+'-Japanese-Conversion'), place=form.querySelector('#JEL-'+view+'-Japanese-Placement');
        const alignment=form.querySelector('#JEL-'+view+'-ReadingAlignment');
        // Test actual layout, not only the hidden flag: author display:flex on
        // HelpRow previously overrode the browser's [hidden] default in Spotify.
        form.querySelectorAll('details').forEach(details=>details.open=true);
        const row=form.querySelector('#JEL-'+view+'-Reading-secondarySize').closest('.BL-HelpRow');
        const ruby=form.querySelector('#JEL-'+view+'-Reading-rubySize').closest('.BL-HelpRow');
        const alignRow=alignment.closest('.BL-HelpRow');
        const sharedStyles=alignment.closest('fieldset'),styleHint=sharedStyles.querySelector(':scope > p');
        check(sharedStyles.matches('.BL-ReadingStyle')&&styleHint?.textContent==='Reading style'&&styleHint===sharedStyles.firstElementChild,'reading styles have their own hint');
        const readingEffects=form.querySelector('#JEL-'+view+'-Word-ReadingInherit').closest('details');
        const visible=element=>getComputedStyle(element).display!=='none'&&element.getClientRects().length>0;
        const checkVisibility=(above,attached)=>{
          check(visible(row)===above&&visible(ruby)===attached,'computed reading size visibility '+view);
          check(visible(alignRow)===(above||attached)&&visible(readingEffects)===(above||attached),'computed alignment/effect visibility '+view);
          check(visible(styleHint)===(above||attached),'Reading style hint follows shared style visibility '+view);
          if(above||attached){const languageLabel=form.querySelector('#JEL-'+view+'-Japanese').labels[0].getBoundingClientRect().left;nearLayout(alignRow.querySelector('label').getBoundingClientRect().left,languageLabel,'shared reading labels align with language toggles '+view);nearLayout(styleHint.getBoundingClientRect().left+parseFloat(getComputedStyle(styleHint).paddingLeft),languageLabel,'Reading style hint aligns with language toggles '+view);}
          for(const element of [row,ruby,alignRow,readingEffects])if(element.hidden)check(getComputedStyle(element).display==='none'&&element.getClientRects().length===0,'hidden relevance has no layout box '+view);
        };
        for(const kind of ['romaji','kana'])for(const value of ['replace','above']) {
          conversion.value=kind;change(conversion);place.value=value;change(place);
          check(PresentationSettings.getConversions(view).languages.Japanese.kind===kind&&PresentationSettings.getConversions(view).languages.Japanese.placement===value,'conversion x placement saves '+view);
          check(alignment.disabled===(value==='replace'),'alignment availability follows placement '+view);
          const effect=form.querySelector('#JEL-'+view+'-Word-ReadingInherit');check(effect.matches(':disabled')===(value==='replace'),'reading effects availability follows placement '+view);checkVisibility(value==='above',false);
        }
        conversion.value='furigana';change(conversion);check(place.disabled&&place.value==='attached','attached matrix '+view);checkVisibility(false,true);
        const toggle=form.querySelector('#JEL-'+view+'-Japanese');toggle.click();check(alignment.disabled,'disabled language hides annotation styling '+view);checkVisibility(false,false);toggle.click();checkVisibility(false,true);
        for(const language of ['Chinese','Korean']) {const input=form.querySelector('#JEL-'+view+'-'+language);input.click();const choice=PresentationSettings.getConversions(view).languages[language];check(choice.kind===(language==='Chinese'?'pinyin':'romaja'),'language-specific kind');input.click();}
      }
      const inherit=form.querySelector('#JEL-FullLyrics-Word-ReadingInherit');inherit.click();
      const readingGlow=form.querySelector('#JEL-FullLyrics-Word-Reading-glow');readingGlow.click();
      check(!PresentationSettings.getAnnotations('FullLyrics').cases.Word.inherit&&!PresentationSettings.getAnnotations('FullLyrics').cases.Word.effects.glow&&PresentationSettings.getAnnotations('FullLyrics').cases.Line.inherit,'reading effects are sourcecase scoped');
      check(annotationEvents===3,'reading events use a separate immediate channel');
      const readingResponse=form.querySelector('#JEL-FullLyrics-Word-Reading-AnimationResponse');
      check(!readingResponse.matches(':disabled'),'independent readings expose response');
      readingResponse.value='slow';change(readingResponse);
      inherit.click();
      check(readingResponse.matches(':disabled'),'inherited reading response is disabled');
      readingResponse.value='direct';change(readingResponse);
      check(PresentationSettings.getAnnotations('FullLyrics').cases.Word.effects.animationResponse==='slow'&&PresentationSettings.getAnnotations('FullLyrics').cases.Line.effects.animationResponse==='classic','inherited readings retain their scoped override');
      inherit.click();
      check(!readingResponse.matches(':disabled')&&readingResponse.value==='slow','reading response restores its saved value when the override returns');
      const lineInherit=form.querySelector('#JEL-FullLyrics-Line-ReadingInherit');
      wordDetail.value='line';change(wordDetail);
      check(inherit.matches(':disabled')&&inherit.closest('[hidden]')&&!lineInherit.matches(':disabled'),'whole-line display exposes the relevant Line reading controls');
      wordDetail.value='word';change(wordDetail);
      check(!inherit.matches(':disabled')&&!inherit.checked&&readingResponse.value==='slow','Word returns with its independent reading effects');
      check(sourceEvents===0&&demandEvents===0,'text/cue/language/timing do not invalidate providers');
      const token=form.querySelector('#BL-SpicyToken');type(token,'fixture_new_key');check(sourceEvents===0,'partial credential input does not reload');
      const fetch=form.querySelector('#BL-FetchMode');fetch.value='required';change(fetch);
      check(data.get('BeautifulLyricsLocal/SpicyToken')==='  fixture_original_key  '&&sourceEvents===0&&demandEvents===1,'behavior event leaves raw credentials untouched');
      token.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      check(sourceEvents===1&&data.get('BeautifulLyricsLocal/SpicyToken')==='fixture_new_key'&&token.type==='password','completed masked credential applies once');
      fetch.value='change';change(fetch);check(data.get('BeautifulLyricsLocal/SpicyToken')==='fixture_new_key','later behavior cannot restore stale token');
      const sidebar=form.querySelector('#BL-SidebarEnabled');sidebar.click();
      const nowFields=form.querySelector('#JEL-NowPlaying-Options');check(nowFields.hidden&&nowFields.disabled&&sidebar.getAttribute('aria-expanded')==='false','whole disabled Now Playing subtree collapsed');
      check(Math.abs(sidebar.closest('.BL-Block').getBoundingClientRect().height-56)<=1,'disabled Now Playing block collapses to the Enabled band');
      const hiddenGlow=form.querySelector('#JEL-NowPlaying-Word-glow'),beforeHidden=JSON.stringify([...data]);hiddenGlow.checked=false;change(hiddenGlow);
      check(beforeHidden===JSON.stringify([...data]),'inherited disabled fieldset blocks late synthetic option changes');
      const nowOffset=form.querySelector('#JEL-NowPlaying-TimingOffset');type(nowOffset,'2');check(!nowOffset.matches(':disabled')&&TimingSettings.get('NowPlaying')===2,'Now Playing offset stays enabled and applies with Now Playing off');
      sidebar.click();check(!nowFields.hidden&&!nowFields.disabled,'Now Playing reopens retained subtree');
      // A detached form must stay inert even if later reattached and dispatched.
      type(spacing('Contained'),'63');await frame();check([...form.querySelectorAll('.BL-HorizontalSpacing output')].every(output=>/^Width \\d+ px \\u00b7 left gap \\d+ px \\u00b7 right gap \\d+ px(?: \\u00b7 at limit)?$/.test(output.textContent)||output.textContent==='Unavailable while the lyrics column is hidden'),'spacing readouts use rounded px or the hidden-column message');
      check([...form.querySelectorAll('.BL-HelpRow:not(.BL-HorizontalSpacing) > output')].every(output=>/^\\d+(?:\\.\\d+)? px$/.test(output.textContent)||output.textContent==='Unavailable while the lyrics column is hidden'),'size readouts use px without CSS');
      const old=form,oldPreset=wordPreset,oldBytes=JSON.stringify([...data]);help.focus();fixtureModal.hide();
      check(PresentationSettings.getEffectiveHorizontalSpacing('Contained')===PresentationSettings.getHorizontalSpacing('Contained')&&!document.querySelector('.JEL-TypographyPreview'),'close cancels preview and removes probes');
      check(popups.every(p=>p.destroyed)&&!document.querySelector('.BL-SettingsHelpPopup'),'disconnect cleans all tooltips');
      fixtureModal.display({content:old});oldPreset.value='classic';change(oldPreset);holdWord.checked=false;change(holdWord);check(oldBytes===JSON.stringify([...data]),'reattached disposed form cannot persist, including word hold');
      const submit=new Event('submit',{cancelable:true});old.dispatchEvent(submit);check(submit.defaultPrevented,'disposed form cannot navigate');
      // Values predating the spinner step remain exact on open, including blur.
      data.set('BeautifulLyricsLocal/RichSyncCompensation',JSON.stringify({holdSeconds:3.57,minimumSegmentsPerLine:2.345,holdWordSync:true}));
      const fractionalBytes=JSON.stringify([...data]),fractionalWrites=storageWrites;
      OpenProviderSettings();form=fixtureForm;
      for(const [id,value] of [['#BL-RichSyncHoldSeconds','3.57'],['#BL-RichSyncMinimumSegments','2.345']]){const input=form.querySelector(id);check(input.value===value&&input.step==='0.1','saved non-step value displays exactly');input.dispatchEvent(new FocusEvent('blur'));check(input.value===value,'blur preserves saved non-step value');}
      check(JSON.stringify([...data])===fractionalBytes&&storageWrites===fractionalWrites,'opening non-step values performs no writes');
      type(spacing('Fullscreen'),'72');const beforeReplacement=popups.slice();fixtureModal.display({content:document.createElement('div')});check(beforeReplacement.every(p=>p.destroyed)&&PresentationSettings.getEffectiveHorizontalSpacing('Fullscreen')===0,'replacement releases help/handlers and spacing preview');
      OpenProviderSettings();form=fixtureForm;const beforeDispose=JSON.stringify([...data]);GlobalMaid.Destroy();
      const disposed=form.querySelector('#JEL-FullLyrics-GapThreshold');type(disposed,'50');
      const disposedWordHold=form.querySelector('#BL-RichSyncHoldWordSync');disposedWordHold.checked=false;change(disposedWordHold);
      check(disposedWordHold.disabled,'runtime disposal disables word-hold toggle');
      check(form.isConnected&&disposed.disabled&&beforeDispose===JSON.stringify([...data]),'runtime disposal disables connected controls and aborts writes');
      fixtureModal.hide();document.body.textContent='SETTINGS_HELP_PASS';
    } catch(error) {document.body.textContent='SETTINGS_HELP_FAIL: '+error.message;}
    globalThis.jelTestComplete(document.body.textContent);
  }, {once:true});`;
  const directory = path.resolve(await mkdtemp(path.join(tmpdir(), 'jel-help-')));
  try {
    const html = path.join(directory, 'fixture.html');
    await writeFile(html, `<!doctype html><body><style>${css}</style><script>${script.replaceAll('</script', '<\\/script')}</script>`);
    const result = await runFocusedFixture(chrome, html, path.join(directory, 'profile'));
    assert.match(result, /SETTINGS_HELP_PASS/, result);
    assert.doesNotMatch(result, /SETTINGS_HELP_FAIL/);

  } finally {
    // Resolve/check the exact temporary target before recursive Windows cleanup.
    assert.ok(directory.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith('jel-help-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
