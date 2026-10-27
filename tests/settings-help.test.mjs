import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as sass from 'sass';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const chrome = process.env.CHROME_BIN || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

test('settings help preserves native labels/drafts and disposes popup DOM on close/replacement/runtime disposal', { skip: !chrome }, async () => {
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
  const css = sass.compile('Extension/Source/Stylings/ProviderControls.scss').css;
  const script = `(() => {
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const data=new Map([
      ['JustEnoughLyrics/Timing',JSON.stringify({version:1,offsets:{Shared:.25,NowPlaying:-.5,FullLyrics:1}})],
      ['BeautifulLyrics/LyricViews',JSON.stringify({Version:1,Items:{RomanizedLanguages:{Japanese:true}}})],
    ]);
    const localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
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
      let sourceEvents=0,demandEvents=0,timingEvents=0,languageEvents=0;
      OnProviderSettingsChanged(()=>sourceEvents++);OnBehaviorSettingsChanged(()=>demandEvents++);
      TimingSettings.subscribe(()=>timingEvents++);PresentationSettings.subscribe(()=>languageEvents++);
      OpenProviderSettings();
      let form=fixtureForm;
      const shared=form.querySelector('#JEL-Shared-TimingOffset');
      const now=form.querySelector('#JEL-NowPlaying-TimingOffset');
      const full=form.querySelector('#JEL-FullLyrics-TimingOffset');
      const japaneseForm=form.querySelector('#JEL-FullLyrics-JapaneseForm');
      check(japaneseForm.value==='romaji'&&form.querySelector('#JEL-FullLyrics-Japanese').parentElement.textContent==='Japanese','migrated Japanese form is explicit and language label remains accurate');
      check(![...form.querySelectorAll('h3')].some(h=>h.textContent==='Timing'),'no standalone timing section');
      check(shared.closest('section').querySelector('h3').textContent==='Behavior','shared delay belongs to Behavior');
      check(shared.labels[0].textContent==='Lyric delay (s)','concise shared label');
      check(now.labels[0].textContent==='Delay offset (s)'&&full.labels[0].textContent==='Delay offset (s)','concise view labels');
      check(shared.getAttribute('aria-label')==='Shared lyric delay in seconds'&&full.getAttribute('aria-label')==='Full Lyrics delay offset in seconds','accessible names match visible terminology');
      check(![...form.querySelectorAll('button')].some(b=>b.textContent.includes('Restore Classic')),'defaults live in tooltip footer');
      const master=form.querySelector('#JEL-NowPlaying-RomanizationEnabled');
      const options=form.querySelector('#JEL-NowPlaying-RomanizationOptions');
      const help=master.previousElementSibling;
      check(help.classList.contains('BL-HelpButton')&&!help.closest('label'),'help is a sibling before control');
      check(help.previousElementSibling===master.labels[0],'help follows title label');
      const titleRect=master.labels[0].getBoundingClientRect(),helpRect=help.getBoundingClientRect(),controlRect=master.getBoundingClientRect();
      check(titleRect.right<=helpRect.left&&helpRect.left-titleRect.right<=13&&helpRect.right<=controlRect.left,'help geometry is title-adjacent before the right-aligned control');
      for(const view of ['NowPlaying','FullLyrics']) {
        const toggle=form.querySelector('#JEL-'+view+'-RomanizationEnabled');
        const row=toggle.closest('.BL-HelpRow');
        const expectedRight=row.getBoundingClientRect().right-parseFloat(getComputedStyle(row).paddingRight);
        check(Math.abs(toggle.getBoundingClientRect().right-expectedRight)<=1,'romanization switch aligns with row right padding');
      }
      check(master.labels[0].htmlFor===master.id,'native explicit label association');
      const originalChecked=master.checked;
      const originalBytes=JSON.stringify([...data]);
      help.focus();help.click();help.dispatchEvent(new MouseEvent('mouseenter'));
      check(document.activeElement===help&&master.checked===originalChecked,'help does not toggle or focus switch');
      check(document.getElementById(help.getAttribute('aria-describedby')).textContent.endsWith('Classic: Off'),'stable accessible default description');
      check(document.querySelector('.BL-SettingsHelpPopup .BL-HelpClassic').textContent==='Classic: Off','classic is popup footer');
      let escaped=0;
      const countEscape=event=>{if(event.key==='Escape')escaped++};
      form.addEventListener('keydown',countEscape);
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      check(!document.querySelector('.BL-SettingsHelpPopup'),'Escape hides help');
      check(escaped===0,'visible tooltip consumes first Escape');
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      check(escaped===1,'second Escape can reach modal');
      help.dispatchEvent(new MouseEvent('mouseenter'));
      check(!!document.querySelector('.BL-SettingsHelpPopup'),'hover opens help');
      help.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      help.click();
      check(!!document.querySelector('.BL-SettingsHelpPopup'),'click opens help');
      const numberHelp=full.previousElementSibling;
      numberHelp.focus();numberHelp.click();
      check(document.activeElement===numberHelp&&full.value==='1','numeric help does not edit/focus input');
      const popup=[...document.querySelectorAll('.BL-SettingsHelpPopup')].find(p=>p.dataset.helpFor===numberHelp.getAttribute('aria-describedby'));
      check(popup.lastElementChild.textContent==='Classic: 0 s','delay default appears last');
      check(JSON.stringify([...data])===originalBytes&&sourceEvents===0&&demandEvents===0&&timingEvents===0&&languageEvents===0,'help has no writes or notifications');
      master.labels[0].click();
      check(master.checked!==originalChecked&&options.hidden===!master.checked,'title label still toggles native switch and expansion');
      master.labels[0].click();
      full.value='1.5';
      japaneseForm.value='kana';
      check(TimingSettings.get('FullLyrics')===1,'numeric edit remains draft');
      check(PresentationSettings.getProfile('FullLyrics').japaneseForm==='romaji','Japanese form remains draft');
      form.requestSubmit();
      check(TimingSettings.get('FullLyrics')===1.5&&TimingSettings.get('Shared')===.25&&TimingSettings.get('NowPlaying')===-.5,'Save keeps scoped offset behavior');
      check(sourceEvents===0&&demandEvents===0,'timing/help do not invalidate providers');
      check(PresentationSettings.getProfile('FullLyrics').japaneseForm==='kana'&&PresentationSettings.getProfile('NowPlaying').japaneseForm==='romaji','Japanese primary form saves only its view');
      check(form.querySelector('[role=status]').textContent==='Settings saved.','visible save status');
      numberHelp.focus();numberHelp.click();
      fixtureModal.hide();
      check(!document.querySelector('.BL-SettingsHelpPopup')&&popups.every(p=>p.destroyed),'native disconnect destroys external popup DOM');
      OpenProviderSettings();
      const before=popups.slice();
      fixtureForm.querySelector('.BL-HelpButton').focus();
      fixtureModal.display({content:document.createElement('div')});
      check(before.every(p=>p.destroyed)&&!document.querySelector('.BL-SettingsHelpPopup'),'host replacement destroys old help');
      OpenProviderSettings();
      form=fixtureForm;
      form.querySelector('.BL-HelpButton').focus();
      GlobalMaid.Destroy();
      check(form.isConnected&&!document.querySelector('.BL-SettingsHelpPopup')&&popups.every(p=>p.destroyed),'runtime disposal clears connected form tips');
      check(form.querySelector('button[type=submit]').disabled,'disposed Save disabled');
      const submit=new Event('submit',{cancelable:true});form.dispatchEvent(submit);
      check(submit.defaultPrevented,'disposed connected form cannot perform native navigation');
      fixtureModal.hide();
      document.body.textContent='SETTINGS_HELP_PASS';
    } catch(error) {document.body.textContent='SETTINGS_HELP_FAIL: '+error.message;}
  })();`;
  const directory = path.resolve(await mkdtemp(path.join(tmpdir(), 'jel-help-')));
  try {
    const html = path.join(directory, 'fixture.html');
    await writeFile(html, `<!doctype html><body><style>${css}</style><script>${script.replaceAll('</script', '<\\/script')}</script>`);
    const browser = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(directory, 'profile'), '--dump-dom', pathToFileURL(html).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000, windowsHide: true });
    assert.equal(browser.error, undefined, browser.error?.message);
    assert.equal(browser.status, 0, browser.stderr);
    assert.match(browser.stdout, /SETTINGS_HELP_PASS/, browser.stdout);
    assert.doesNotMatch(browser.stdout, /SETTINGS_HELP_FAIL/);
  } finally {
    // Resolve/check the exact temporary target before recursive Windows cleanup.
    assert.ok(directory.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith('jel-help-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
