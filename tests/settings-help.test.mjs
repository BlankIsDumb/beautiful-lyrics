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
    export {OpenProviderSettings} from './Extension/Source/ProviderControls.ts';
    export {PresentationSettings} from './Extension/Source/PresentationSettings.ts';
    export {TimingSettings} from './Extension/Source/TimingSettings.ts';
    export {OnProviderSettingsChanged,OnBehaviorSettingsChanged} from './Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts';
    export {GlobalMaid} from '@Spices/Spicetify/Services/Session.ts';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'formModule', plugins: [{ name: 'synthetic-host', setup(b) {
      b.onResolve({ filter: /Session\.ts$/ }, () => ({ path: 'session', namespace: 'fixture' }));
      b.onResolve({ filter: /Player\/mod\.ts$/ }, () => ({ path: 'player', namespace: 'fixture' }));
      b.onResolve({ filter: /ProviderSettings\.ts$/ }, () => ({ path: path.resolve('Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts') }));
      b.onResolve({ filter: /Icons\.ts$/ }, () => ({ path: 'icons', namespace: 'fixture' }));
      b.onLoad({ filter: /\.scss$/ }, () => ({ contents: '' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'session'
        ? `export const Spotify={PopupModal:fixtureModal,Tippy:fixtureTippy};
           export const GlobalMaid={items:[],Give(fn){this.items.push(fn);return fn},Destroy(){for(const fn of this.items)fn()}};
           export const OnSpotifyReady=new Promise(()=>{});export const ShowNotification=()=>{throw Error('unexpected notification')};`
        : a.path === 'player' ? `export const SongLyrics=undefined,SongLyricChoices=[],SongChanged={},SongLyricsLoaded={};export const SelectLyricsProvider=()=>{};`
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
    let fixtureForm;
    const modal=document.createElement('div');
    const fixtureModal={display({content}){modal.replaceChildren(content);document.body.append(modal);fixtureForm=content},hide(){modal.remove()}};
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
      const {OpenProviderSettings,PresentationSettings,TimingSettings,OnProviderSettingsChanged,OnBehaviorSettingsChanged,GlobalMaid}=formModule;
      let sourceEvents=0,demandEvents=0,timingEvents=0,languageEvents=0,renderEvents=0,cueEvents=0;
      OnProviderSettingsChanged(()=>sourceEvents++);OnBehaviorSettingsChanged(()=>demandEvents++);
      TimingSettings.subscribe(()=>timingEvents++);PresentationSettings.subscribe(()=>languageEvents++);
      PresentationSettings.subscribeRendering(()=>renderEvents++);PresentationSettings.subscribeCues(()=>cueEvents++);
      OpenProviderSettings();let form=fixtureForm;
      const change=control=>control.dispatchEvent(new Event('change',{bubbles:true}));
      const type=(control,value)=>{control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}))};
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
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
      [...cardRow.querySelectorAll('button')].find(button=>button.textContent.startsWith('Reset ')).click();
      check(PresentationSettings.getHorizontalSpacing('Card')===0,'per-surface reset');
      const beforeFailure=JSON.stringify([...data]);type(spacing('Contained'),'55');failStorage=true;change(spacing('Contained'));failStorage=false;
      check(JSON.stringify([...data])===beforeFailure&&PresentationSettings.getHorizontalSpacing('Contained')===0&&PresentationSettings.getEffectiveHorizontalSpacing('Contained')===0&&spacingNumber('Contained').value==='0','failed commit restores canonical spacing and controls');
      const anchor=form.querySelector('#JEL-FullLyrics-Layout-anchor');
      check(anchor.required&&anchor.step==='any','anchor is required and accepts fractional percentages');
      type(anchor,'34.125');check(PresentationSettings.getLayout('FullLyrics').anchor===34.125,'fractional anchor retained');
      const beforeBlank=JSON.stringify([...data]);type(anchor,'');check(JSON.stringify([...data])===beforeBlank,'empty anchor does not save legacy mode');anchor.dispatchEvent(new FocusEvent('blur'));check(anchor.value==='34.125','empty anchor blur restores exact percentage');
      type(anchor,'45');
      check(!form.querySelector('button[type=submit]'),'no Save button');
      check([...form.querySelectorAll('h3')].some(h=>h.textContent==='Lyrics'),'Lyrics hierarchy');
      check(form.querySelectorAll('.BL-ViewOptions > details.BL-CaseSettings[id$="-Settings"]').length===4,'four native collapsible source cases');
      for(const view of ['NowPlaying','FullLyrics']){
        check(!form.querySelector('#JEL-'+view+'-Line-TextDetail')&&!form.querySelector('#JEL-'+view+'-Line-verticalMotion')&&!form.querySelector('#JEL-'+view+'-Line-emphasis'),'Line case omits unsupported word capabilities');
        check(form.querySelector('#JEL-'+view+'-CueMotion')&&!form.querySelector('#JEL-'+view+'-Word-cueAnimation'),'cue options view-wide only');
      }
      const shared=form.querySelector('#JEL-Shared-TimingOffset'),full=form.querySelector('#JEL-FullLyrics-TimingOffset');
      check(shared.closest('section').querySelector('h3').textContent==='Behavior','shared delay under Behavior');
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
        const readingEffects=form.querySelector('#JEL-'+view+'-Word-ReadingInherit').closest('details');
        const visible=element=>getComputedStyle(element).display!=='none'&&element.getClientRects().length>0;
        const checkVisibility=(above,attached)=>{
          check(visible(row)===above&&visible(ruby)===attached,'computed reading size visibility '+view);
          check(visible(alignRow)===(above||attached)&&visible(readingEffects)===(above||attached),'computed alignment/effect visibility '+view);
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
      check(sourceEvents===0&&demandEvents===0,'text/cue/language/timing do not invalidate providers');
      const token=form.querySelector('#BL-SpicyToken');type(token,'fixture_new_key');check(sourceEvents===0,'partial credential input does not reload');
      const fetch=form.querySelector('#BL-FetchMode');fetch.value='required';change(fetch);
      check(data.get('BeautifulLyricsLocal/SpicyToken')==='  fixture_original_key  '&&sourceEvents===0&&demandEvents===1,'behavior event leaves raw credentials untouched');
      token.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      check(sourceEvents===1&&data.get('BeautifulLyricsLocal/SpicyToken')==='fixture_new_key'&&token.type==='password','completed masked credential applies once');
      fetch.value='change';change(fetch);check(data.get('BeautifulLyricsLocal/SpicyToken')==='fixture_new_key','later behavior cannot restore stale token');
      const sidebar=form.querySelector('#BL-SidebarEnabled');sidebar.click();
      const nowFields=form.querySelector('#JEL-NowPlaying-Options');check(nowFields.hidden&&nowFields.disabled&&sidebar.getAttribute('aria-expanded')==='false','whole disabled Now Playing subtree collapsed');
      const hiddenGlow=form.querySelector('#JEL-NowPlaying-Word-glow'),beforeHidden=JSON.stringify([...data]);hiddenGlow.checked=false;change(hiddenGlow);
      const hiddenOffset=form.querySelector('#JEL-NowPlaying-TimingOffset');type(hiddenOffset,'2');check(beforeHidden===JSON.stringify([...data]),'inherited disabled fieldset blocks late synthetic changes');
      sidebar.click();check(!nowFields.hidden&&!nowFields.disabled,'Now Playing reopens retained subtree');
      // A detached form must stay inert even if later reattached and dispatched.
      type(spacing('Contained'),'63');await frame();check([...form.querySelectorAll('.BL-HorizontalSpacing output')].every(output=>output.textContent.includes('CSS px')||output.textContent.includes('unavailable')),'surface readouts report measured units or unavailable geometry');
      const old=form,oldPreset=wordPreset,oldBytes=JSON.stringify([...data]);help.focus();fixtureModal.hide();
      check(PresentationSettings.getEffectiveHorizontalSpacing('Contained')===PresentationSettings.getHorizontalSpacing('Contained')&&!document.querySelector('.JEL-TypographyPreview'),'close cancels preview and removes probes');
      check(popups.every(p=>p.destroyed)&&!document.querySelector('.BL-SettingsHelpPopup'),'disconnect cleans all tooltips');
      fixtureModal.display({content:old});oldPreset.value='classic';change(oldPreset);check(oldBytes===JSON.stringify([...data]),'reattached disposed form cannot persist');
      const submit=new Event('submit',{cancelable:true});old.dispatchEvent(submit);check(submit.defaultPrevented,'disposed form cannot navigate');
      OpenProviderSettings();form=fixtureForm;type(spacing('Fullscreen'),'72');const beforeReplacement=popups.slice();fixtureModal.display({content:document.createElement('div')});check(beforeReplacement.every(p=>p.destroyed)&&PresentationSettings.getEffectiveHorizontalSpacing('Fullscreen')===0,'replacement releases help/handlers and spacing preview');
      OpenProviderSettings();form=fixtureForm;const beforeDispose=JSON.stringify([...data]);GlobalMaid.Destroy();
      const disposed=form.querySelector('#JEL-FullLyrics-GapThreshold');type(disposed,'50');
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
