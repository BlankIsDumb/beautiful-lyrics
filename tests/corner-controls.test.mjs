import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as sass from 'sass';
import {transformSync} from 'esbuild';
import {buildCornerFixture} from './corner-controls-fixture.mjs';
import {runFocusedFixture} from './chromium-focus-harness.mjs';

test('shared quick-setting writes preserve modal storage, other scopes, and rounded step bounds', async () => {
  const code = await buildCornerFixture(false);
  const data = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  try {
    const m = new Function(code + ';return cornerModule')();
    const {StepControlValue:step,TimingOffsetInput:timing,PrimarySizeInput:size,PresentationSettings:p,TimingSettings:t}=m;
    m.SaveTimingOffset('Shared',.5);m.SaveTimingOffset('NowPlaying',-.25);m.SaveTimingOffset('FullLyrics',.3);
    assert.deepEqual(JSON.parse(data.get('JustEnoughLyrics/Timing')).offsets,{Shared:.5,NowPlaying:-.25,FullLyrics:.3});
    m.SaveLayoutField('FullLyrics','primaryRatio',1.35);m.SaveLayoutField('FullLyrics','follow',false);
    m.SaveBackgroundField('FullLyrics','mode','static');
    const saved=JSON.parse(data.get('JustEnoughLyrics/Presentation'));
    assert.equal(saved.profiles.FullLyrics.layout.primaryRatio,1.35);
    assert.equal(saved.profiles.FullLyrics.layout.follow,false);
    assert.equal(saved.profiles.FullLyrics.background.mode,'static');
    const reopened=m.CreatePresentationSettings(globalThis.localStorage);
    assert.deepEqual(reopened.getLayout('FullLyrics'),p.getLayout('FullLyrics'));
    assert.equal(m.CreateTimingSettings(globalThis.localStorage).get('FullLyrics'),t.get('FullLyrics'));
    assert.equal(saved.profiles.NowPlaying.layout.primaryRatio,1);
    for(const bounds of [timing,size]) {
      assert.equal(step(bounds.max,1,bounds),bounds.max);assert.equal(step(bounds.min,-1,bounds),bounds.min);
      assert.equal(step(bounds.max-.01,1,bounds),bounds.max);assert.equal(step(bounds.min+.01,-1,bounds),bounds.min);
    }
    assert.equal(String(step(.25,1,timing)),'0.3');assert.equal(String(step(.35,-1,timing)),'0.3');
    let value=0;for(let i=0;i<6;i++)value=step(value,1,timing);assert.equal(String(value),'0.3');
    // Exact legacy shortcut semantics, including a remembered language while
    // the master is Off. Master-only writes would fail these assertions.
    p.setRomanized('FullLyrics','Japanese',true);
    p.setRomanized('FullLyrics','Chinese',true);
    p.setRomanized('FullLyrics','Japanese',false);
    assert.equal(p.getConversions('FullLyrics').enabled,true);
    assert.equal(p.getConversions('FullLyrics').languages.Japanese.enabled,false);
    assert.equal(p.isRomanized('FullLyrics','Chinese'),true);
  } finally {globalThis.localStorage=previous;}
});

const pageSources=Object.fromEntries(['Fullscreen','Contained'].map(surface=>[surface,readFileSync('Extension/Source/LyricViews/Page/'+surface+'.ts','utf8')]));
const template=(surface,name)=>pageSources[surface].match(new RegExp('const '+name+' = `([\\s\\S]*?)`'))?.[1].replace(/\$\{[^}]*\}/g,'')||'';
const templates={Fullscreen:template('Fullscreen','Container'),Contained:template('Contained','Container')};
test('both page surfaces mount corners in the lyric area and remove obsolete page controls/assets',()=>{
  for(const surface of ['Fullscreen','Contained']) {
    const source=pageSources[surface];
    assert.match(source,/SetupProviderControls\(content, this\.Maid\)/);
    assert.doesNotMatch(source,/Romanize|SetupRomanizationButton|SetupProviderControls\((?:header|viewControls),/);
  }
  assert.doesNotMatch(readFileSync('Extension/Source/ProviderControls.ts','utf8'),/Additional Options|BL-ProviderMenu|BL-OptionsButton/);
  assert.doesNotMatch(readFileSync('Extension/Source/Stylings/ProviderControls.scss','utf8'),/BL-ProviderMenu|BL-ProviderOpen/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/Page/Shared.ts','utf8'),/SetupRomanizationButton/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/Page/Icons.ts','utf8'),/EnableRomanization|DisableRomanization/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/Page/style.scss','utf8'),/#Romanize/);
  assert.doesNotMatch(pageSources.Contained,/ViewControls|#Cinema|#Close|const Header|HeaderQuery|Enter Cinema/);
  assert.doesNotMatch(templates.Contained,/id="(?:Cinema|Close)"/);
  assert.doesNotMatch(readFileSync('Extension/Source/LyricViews/Page/style.scss','utf8'),/:has\(\.BeautifulLyricsPage\.Contained\)|#Cinema/);
});

test('corner menu rules leave border radii themeable',()=>{
  const css=sass.compile('Extension/Source/Stylings/ProviderControls.scss').css;
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(rule=>rule[1].includes('.BL-CornerMenu'));
  assert.ok(rules.length>0,'compiled menu rules exist');
  for(const rule of rules)assert.doesNotMatch(rule[2],/border-(?:radius|(?:top|bottom)-(?:left|right)-radius)\s*:[^;}]*!important/i,rule[1]);
});

test('Contained keeps public close, no-song handling and cleanup without the hover row',()=>{
  const {code}=transformSync(pageSources.Contained,{loader:'ts',format:'cjs',target:'chrome120'});
  for(const previous of ['/collection',undefined]) {
    const pushes=[],closed=[],content={},calls=[];let onSong,pending,removed=false,backgroundDestroyed=false;
    // Execute the actual controller with small host substitutes. The public
    // Close path is still used by the playbar after the visible row is removed.
    const player={Song:{},SongChanged:{Connect(callback){onSong=callback;return {Disconnect(){onSong=undefined}}}}};
    const history={entries:previous?[{pathname:previous},{pathname:'/BeautifulLyrics/Page'}]:[],push:value=>pushes.push(value)};
    const container={querySelector(selector){assert.equal(selector,'.Content');return content},remove(){removed=true}};
    const page={style:{},appendChild(node){assert.equal(node,container)}};
    class Maid {
      items=[];Destroyed={Connect:callback=>closed.push(callback)};
      Give(item){this.items.push(item);return item}
      Destroy(){for(const item of this.items.splice(0)){if(typeof item==='function')item();else if(item.Destroy)item.Destroy();else if(item.Disconnect)item.Disconnect();else item.remove()}for(const callback of closed)callback()}
    }
    const dependencies={
      '../../ProviderControls.ts':{SetupProviderControls:area=>calls.push(['controls',area])},
      './style.scss':{},'@Universal/Modules/Maid.ts':{Maid},
      '@Universal/Modules/Scheduler.ts':{Timeout(delay,callback){assert.equal(delay,1);pending=callback;return {Destroy(){pending=undefined}}}},
      '@Spices/Spicetify/Services/Session.ts':{SpotifyHistory:history},
      '@Spices/Spicetify/Services/Player/mod.ts':player,
      './Shared.ts':{CreateLyricsRenderer:area=>calls.push(['renderer',area])},
      '../Shared.ts':{CreateElement(html){assert.doesNotMatch(html,/ViewControls|id="(?:Cinema|Close)"/);return container}},
      '../../Modules/Background/BackgroundController.ts':class {Destroy(){backgroundDestroyed=true}},
    };
    const module={exports:{}};
    new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,name);return dependencies[name]},module,module.exports);
    const view=new module.exports.default(page,true);let didClose=0;view.Closed.Connect(()=>didClose++);
    assert.deepEqual(calls,[['renderer',content],['controls',content]]);
    assert.equal(page.style.containerType,'inline-size');
    pending();assert.deepEqual(pushes,[]);
    view.Close();assert.equal(pushes.pop(),previous??'/');
    player.Song=undefined;onSong();assert.equal(pushes.pop(),previous??'/');
    pending();assert.equal(pushes.pop(),previous??'/');
    view.Destroy();assert.equal(page.style.containerType,'');
    assert.ok(removed&&backgroundDestroyed);assert.equal(onSong,undefined);assert.equal(pending,undefined);assert.equal(didClose,1);
  }
});

const chrome=process.env.CHROME_BIN||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('corner controls: native layout, menus, modal parity, keyboard, fullscreen and teardown', {skip:!chrome}, async()=>{
  const code=await buildCornerFixture();
  // Theme button radii remain intentional, including on provider and All
  // settings rows. The inset layout must allow this higher-specificity rule.
  const css=['Extension/Source/Stylings/ProviderControls.scss','Extension/Source/LyricViews/Page/style.scss'].map(file=>sass.compile(file).css).join('\n')+
    '\n:root button:not([data-theme-exempt]):not([data-theme-plain]) { border-radius: 8px !important; }';
  const directory=await mkdtemp(path.join(tmpdir(),'jel-corners-'));
  try {
    for(const future of [false,true]) {
      const script=`window.addEventListener('load',async()=>{
        const check=(ok,message)=>{if(!ok)throw Error(message)};
        const near=(a,b,message)=>check(Math.abs(a-b)<1,message+' '+a+' / '+b);
        const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const data=new Map(),future=${future};let failStorage=false;
        if(future){data.set('JustEnoughLyrics/Timing',JSON.stringify({version:999}));data.set('JustEnoughLyrics/Presentation',JSON.stringify({version:999}));}
        const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error('quota');data.set(key,value)},removeItem:key=>data.delete(key)};
        Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
        class Maid{items=[];Give(item){this.items.push(item);return item}Destroy(){for(const item of this.items.splice(0)){if(typeof item==='function')item();else if(item.Disconnect)item.Disconnect();else item.remove()}}}
        globalThis.fixtureGlobalMaid=new Maid();
        const tooltips=[];let form;
        const modal=document.createElement('div');modal.className='spicetify-popup-container';
        globalThis.fixtureSpotify={TippyProps:{},PopupModal:{display({content}){modal.replaceChildren(content);document.body.append(modal);form=content},hide(){modal.remove()}},Tippy(button,props){
          const popup={content:props.content,destroyed:false,setContent(value){this.content=value},hide(){this.popper?.remove()},destroy(){this.destroyed=true;this.hide()}};
          if(props.render)popup.popper=props.render().popper;tooltips.push(popup);return popup;
        }};
        ${code}
        const m=cornerModule,p=m.PresentationSettings,t=m.TimingSettings;
        const lyric=(name,type,word=false,language='Japanese')=>({Type:type,Source:{Provider:name,HasWordSync:word},RomanizedLanguage:language});
        const choices=[lyric('Musixmatch','Syllable',true),lyric('Spotify','Static'),lyric('LRCLIB','Line'),lyric('AMLL','Syllable',true)];
        const templates=${JSON.stringify(templates)};
        const mounted=[];
        const visible=element=>{for(let node=element;node instanceof HTMLElement;node=node.parentElement){const s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false}return element.getClientRects().length>0};
        function mount(surface){
          // Keep the first anchor inside the headless viewport so normal
          // above-button placement is tested separately from viewport clamping.
          const host=document.createElement('div');host.className='Root__main-view';host.style.cssText='width:760px;height:min(360px, calc(100vh - 32px));position:relative;container-type:size';document.body.append(host);
          host.innerHTML=templates[surface];const area=host.querySelector('.Content');
          const maid=new Maid();m.SetupProviderControls(area,maid);
          const root=area.querySelector('.BL-CornerControls'),buttons=[...root.querySelectorAll(':scope > button')],panels=[...root.querySelectorAll(':scope > .BL-CornerMenu')];
          const result={host,area,maid,root,buttons,panels};mounted.push(result);return result;
        }
        const button=(panel,text)=>[...panel.querySelectorAll('button')].find(el=>el.textContent===text);
        const control=(panel,label)=>panel.querySelector('[aria-label="'+label+'"]');
        const click=el=>el.click();const change=el=>el.dispatchEvent(new Event('change',{bubbles:true}));
        const shown=()=>[...document.querySelectorAll('.BL-CornerMenu:popover-open')];
        const textLeft=element=>{const range=document.createRange();range.selectNodeContents(element);return range.getBoundingClientRect().left};
        const insetRows=panel=>{
          const bounds=panel.getBoundingClientRect(),style=getComputedStyle(panel),titleLeft=textLeft(panel.querySelector('h3'));
          const borderLeft=parseFloat(style.borderLeftWidth),borderRight=parseFloat(style.borderRightWidth);
          near(bounds.width,240,'menu width stays fixed');
          for(const side of ['Top','Right','Bottom','Left'])near(parseFloat(style['padding'+side]),4,'menu inner padding');
          near(titleLeft-bounds.left-borderLeft,12,'title text keeps 12px inset');
          const rows=panel.querySelectorAll('.BL-QuickRow,button.BL-ProviderChoice,button.BL-AllSettings');
          check(rows.length>0,'menu has full-width rows');
          for(const row of rows){
            const rowBounds=row.getBoundingClientRect(),rowStyle=getComputedStyle(row);
            near(rowBounds.height,40,'row height stays fixed');
            near(rowBounds.left-bounds.left-borderLeft,4,'row sits inside left padding');
            near(bounds.right-borderRight-rowBounds.right,4,'row sits inside right padding');
            near(parseFloat(rowStyle.paddingLeft),8,'row left padding');near(parseFloat(rowStyle.paddingRight),8,'row right padding');
            if(row.matches('.BL-QuickRow')){
              near(row.firstElementChild.getBoundingClientRect().left,titleLeft,'title and row labels align');
              near(bounds.right-borderRight-row.lastElementChild.getBoundingClientRect().right,12,'controls keep 12px inset');
            }else if(row.matches('.BL-AllSettings'))near(textLeft(row),titleLeft,'All settings text aligns with title');
            if(row.matches('button'))check(rowStyle.borderRadius==='8px','theme can round menu buttons');
          }
        };
        try {
          m.SetSong(lyric('Musixmatch','Line',false),choices);
          const first=mount('Fullscreen'),second=mount('Contained');await frame();
          check(!second.host.querySelector('.ViewControls,#Cinema,#Close'),'Contained has no hover controls row or its buttons');
          check(first.host.querySelector('.ViewControls #Close')&&first.host.querySelector('.ViewControls #Fullscreen'),'Fullscreen cover-art controls remain');
          for(const view of mounted){
            check(view.buttons.length===2&&view.buttons.every(el=>el.type==='button'&&visible(el)),'two visible native buttons without hover in '+view.host.querySelector('.BeautifulLyricsPage').className);
            check(!view.host.querySelector('#Romanize,.BL-OptionsButton'),'old buttons gone');
            check(!view.root.closest('.ViewControls,.PlayPanel'),'corners outside hover/inactivity subtree');
            for(const old of view.host.querySelectorAll('.ViewControls')){old.style.opacity='0';old.style.display='none'}
            check(view.buttons.every(visible),'corners survive hidden legacy controls');
            const box=view.area.getBoundingClientRect(),bounds=view.root.getBoundingClientRect();near(box.right-bounds.right,16,'right inset');near(box.bottom-bounds.bottom,16,'bottom inset');
            near(view.buttons[0].getBoundingClientRect().width,40,'button width');near(view.buttons[0].getBoundingClientRect().height,40,'button height');
            check(getComputedStyle(view.root).pointerEvents==='none'&&getComputedStyle(view.buttons[0]).pointerEvents==='auto','pointer-event isolation');
          }
          const [providerButton,quickButton]=first.buttons,[provider,quick]=first.panels;
          for(const id of ['Musixmatch','AMLL','LRCLIB','Spotify']) {
            m.SetSong(lyric(id,'Line'));check(first.root.firstElementChild.textContent===id,'plain provider credit '+id);
            near(first.root.firstElementChild.getBoundingClientRect().bottom,providerButton.getBoundingClientRect().bottom,'one-line credit bottom aligns with provider button');
          }
          for(const [source,text] of [['apple_music','Apple Music'],['spotify','Spotify'],['unknown','Unknown source']]) {
            m.SetSong({...lyric('Spicy','Line'),Attribution:{Source:source,People:[]}});
            check(first.root.firstElementChild.textContent===text+' \\u00b7 Spicy Lyrics','Spicy source before provider');
          }
          const spicy={...lyric('Spicy','Line'),Attribution:{Source:'spicy_lyrics',People:[{Name:'Sppq',Role:'Uploader',URL:'https://spicylyrics.org/user/sppq'},{Name:'ShoQB',Role:'Maker'}]}};
          m.SetSong(spicy,choices,m.SongLyricsLoaded);
          check(first.root.firstElementChild.textContent==='Spicy Lyrics \\u00b7 Sppq \\u00b7 ShoQB','Spicy people after provider');
          const creditLink=first.root.firstElementChild.querySelector('a');
          check(creditLink.target==='_blank'&&creditLink.rel==='noopener noreferrer'&&creditLink.title==='Uploader: Sppq','corner safe links and role title');
          check(first.root.firstElementChild.querySelector('span.BL-CreditPerson').title==='Maker: ShoQB','unlinked person title');
          m.SetSong({...spicy,Attribution:{Source:'spicy_lyrics',People:[{Name:'Long contributor '.repeat(30),Role:'Uploader'}]}});await frame();
          for(const view of mounted) {
            const credit=view.root.firstElementChild,box=view.area.getBoundingClientRect();
            check(credit.getBoundingClientRect().height>40&&getComputedStyle(credit).textOverflow!=='ellipsis','corner wraps without truncation');
            near(box.right-view.buttons[1].getBoundingClientRect().right,16,'long credit keeps rightmost button right inset');
            for(const button of view.buttons)near(box.bottom-button.getBoundingClientRect().bottom,16,'long credit keeps button bottom inset');
          }
          m.SetSong(lyric('Musixmatch','Line',false),choices);await frame();
          check(first.area.getBoundingClientRect().top>=0&&first.area.getBoundingClientRect().bottom<=document.documentElement.clientHeight,'first lyric area fits fixture viewport');
          click(providerButton);check(shown().length===1&&provider.matches(':popover-open'),'provider opens');
          insetRows(provider);
          check([...first.root.children].every((el,index)=>el===[first.root.querySelector('.BL-CornerCredit'),providerButton,provider,quickButton,quick][index]),'credit first, panels follow their triggers in DOM tab order');
          near(provider.getBoundingClientRect().right,first.root.getBoundingClientRect().right,'menu right-aligns to button row');
          near(provider.getBoundingClientRect().bottom,providerButton.getBoundingClientRect().top-8,'menu opens directly above button');
          // Reproduce an anchor just beyond the viewport bottom independently;
          // its menu must stay visible rather than following it offscreen.
          click(providerButton);
          const fittedHeight=first.host.style.height;
          first.host.style.height=(document.documentElement.clientHeight+80)+'px';await frame();
          check(providerButton.getBoundingClientRect().top>document.documentElement.clientHeight,'clamp case places button beyond viewport bottom');
          click(providerButton);
          const clamped=provider.getBoundingClientRect();
          check(clamped.left>=0&&clamped.top>=0&&clamped.right<=document.documentElement.clientWidth&&clamped.bottom<=document.documentElement.clientHeight,'bottom-edge menu stays fully inside viewport');
          near(clamped.bottom,document.documentElement.clientHeight-8,'bottom-edge menu clamps to viewport inset');
          click(providerButton);first.host.style.height=fittedHeight;await frame();click(providerButton);
          check(providerButton.getAttribute('aria-expanded')==='true','expanded state');
          check([...provider.querySelectorAll('.BL-SyncTag')].map(el=>el.textContent).join(',')==='Line,Plain,Line,Word','tags use effective selected lyrics');
          click(provider.querySelector('[data-provider="AMLL"] .BL-ProviderName'));
          check(m.selected.at(-1)==='AMLL'&&provider.matches(':popover-open'),'row immediately selects and stays open');
          check(provider.querySelector('[data-provider="AMLL"]').getAttribute('aria-pressed')==='true','check moves');
          insetRows(provider);
          check(providerButton.getAttribute('aria-label')==='Lyrics provider: AMLL'&&tooltips[0].content==='Lyrics provider: AMLL','current provider tooltip');
          check(first.root.firstElementChild.textContent==='AMLL','credit follows provider switch');
          const focused=provider.querySelector('[data-provider="AMLL"]');focused.focus();m.SongLyricsLoaded.fire();check(document.activeElement===focused,'refresh preserves focused provider row');
          m.SetSong(undefined,[]);check(provider.matches(':popover-open')&&provider.querySelector('button').disabled&&provider.textContent.includes('No lyrics for this song'),'empty state refresh stays open');
          check(first.root.firstElementChild.hidden&&first.root.firstElementChild.getClientRects().length===0,'no lyrics hides credit without layout space');
          insetRows(provider);
          check(tooltips[0].content==='Lyrics provider','empty tooltip');
          m.SetSong(choices[0],choices);click(quickButton);
          check(shown().length===1&&quick.matches(':popover-open')&&!provider.matches(':popover-open'),'only one menu within surface');
          insetRows(quick);
          const allSettings=button(quick,'All settings'),separator=quick.querySelector(':scope > [role="separator"]');
          check(separator?.tagName==='DIV'&&allSettings.previousElementSibling===separator&&separator.parentElement===quick,'All settings has its own preceding separator');
          check(getComputedStyle(allSettings).borderTopWidth==='0px','All settings has no top border');
          const separatorStyle=getComputedStyle(separator),quickStyle=getComputedStyle(quick);
          near(separator.getBoundingClientRect().width,quick.clientWidth-parseFloat(quickStyle.paddingLeft)-parseFloat(quickStyle.paddingRight),'separator spans menu inner width');
          near(parseFloat(separatorStyle.marginTop),4,'separator top margin');near(parseFloat(separatorStyle.marginBottom),4,'separator bottom margin');
          check(separatorStyle.backgroundColor===quickStyle.borderTopColor,'separator uses menu border color');
          check([...quick.querySelectorAll('.BL-Stepper button')].every(button=>parseFloat(getComputedStyle(button).borderRadius)>0),'stepper buttons retain rounded corners');
          check(quick.textContent.includes('Offset (s)')&&quick.textContent.includes('Text size')&&button(quick,'All settings'),'all quick rows exist');
          check(getComputedStyle(quick.querySelector('h3')).fontSize==='14px'&&getComputedStyle(quick.querySelector('h3')).fontWeight==='700'&&getComputedStyle(quick.querySelector('.BL-QuickRow')).fontWeight==='600','compact modal title/label hierarchy');
          const conversions=control(quick,'Conversions'),follow=control(quick,'Auto-follow'),background=control(quick,'Background');
          const steppers=[...quick.querySelectorAll('.BL-Stepper')];
          const minus=stepper=>stepper.querySelector('button'),plus=stepper=>stepper.querySelector('button:last-child');
          const output=stepper=>stepper.querySelector('output').value;
          if(future){
            check([...quick.querySelectorAll('input,select,.BL-Stepper button')].every(el=>el.disabled),'future settings disable every quick edit');
            click(button(quick,'All settings'));await frame();check(form,'All settings still available read-only');
            check(form.querySelector('#JEL-FullLyrics-TimingOffset').disabled&&form.querySelector('#JEL-FullLyrics-Layout-primaryRatio').disabled&&form.querySelector('#JEL-FullLyrics-ConversionsEnabled').disabled,'modal read-only matches');
            check(form.querySelector('#JEL-NowPlaying-Layout-cardHeight').disabled,'card height is read-only with future presentation settings');
          }else{
            for(let i=0;i<6;i++)click(plus(steppers[0]));check(output(steppers[0])==='0.3'&&t.get('FullLyrics')===.3,'offset rounds every step');
            click(plus(steppers[1]));check(p.getLayout('FullLyrics').primaryRatio===1.05,'size writes ratio');
            conversions.checked=true;change(conversions);check(p.isRomanized('FullLyrics','Japanese')&&p.getConversions('FullLyrics').enabled,'conversion enables language/master');
            p.setRomanized('FullLyrics','Chinese',true);conversions.checked=false;change(conversions);
            check(!p.getConversions('FullLyrics').languages.Japanese.enabled&&p.getConversions('FullLyrics').enabled&&p.isRomanized('FullLyrics','Chinese'),'conversion off preserves master and other language');
            let profile=p.getConversions('FullLyrics');profile.languages.Japanese.enabled=true;profile.enabled=false;p.saveConversions('FullLyrics',profile);
            check(!conversions.checked,'effective off while master off');conversions.checked=true;change(conversions);check(p.isRomanized('FullLyrics','Japanese'),'remembered language re-enables master');
            follow.checked=false;change(follow);background.value='static';change(background);
            const saved=JSON.parse(data.get('JustEnoughLyrics/Presentation')).profiles.FullLyrics;
            check(saved.layout.primaryRatio===1.05&&saved.layout.follow===false&&saved.background.mode==='static','quick writes canonical storage');
            check(JSON.parse(data.get('JustEnoughLyrics/Timing')).offsets.FullLyrics===.3,'offset canonical storage');
            click(button(quick,'All settings'));await frame();check(form&&!quick.matches(':popover-open'),'All settings closes before opening modal');
            check(form.querySelector('#JEL-FullLyrics-TimingOffset').value==='0.3'&&form.querySelector('#JEL-FullLyrics-Layout-primaryRatio').value==='1.05'&&!form.querySelector('#JEL-FullLyrics-Layout-follow').checked&&form.querySelector('#JEL-FullLyrics-Background-mode').value==='static'&&form.querySelector('#JEL-FullLyrics-Japanese').checked,'modal reopens with quick values');
            const write=(id,value,event='input')=>{const el=form.querySelector(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}))};
            write('#JEL-FullLyrics-TimingOffset','.4');write('#JEL-FullLyrics-Layout-primaryRatio','1.1');write('#JEL-FullLyrics-Layout-follow',true,'change');write('#JEL-FullLyrics-Background-mode','off','change');write('#JEL-FullLyrics-Japanese',false,'change');
            modal.remove();click(quickButton);
            check(output(steppers[0])==='0.4'&&output(steppers[1])==='1.1'&&follow.checked&&background.value==='off'&&!conversions.checked,'menu reads modal writes on reopen');
            m.SaveTimingOffset('FullLyrics',29.99);click(plus(steppers[0]));check(t.get('FullLyrics')===30&&plus(steppers[0]).disabled,'offset upper clamp');
            m.SaveTimingOffset('FullLyrics',-29.99);click(minus(steppers[0]));check(t.get('FullLyrics')===-30&&minus(steppers[0]).disabled,'offset lower clamp');
            m.SaveLayoutField('FullLyrics','primaryRatio',1.99);click(plus(steppers[1]));check(p.getLayout('FullLyrics').primaryRatio===2&&plus(steppers[1]).disabled,'size upper clamp');
            m.SaveLayoutField('FullLyrics','primaryRatio',.51);click(minus(steppers[1]));check(p.getLayout('FullLyrics').primaryRatio===.5&&minus(steppers[1]).disabled,'size lower clamp');
            m.SetSong(lyric('Spotify','Static',false,undefined));check(follow.disabled,'static follow matches disabled modal');
            m.SetSong({...choices[0],RomanizedLanguage:undefined});check(conversions.disabled&&!conversions.checked,'nonconvertible off/disabled');
            m.SetSong({...choices[0],RomanizedLanguage:'Chinese'});check(!conversions.disabled&&conversions.checked,'song refresh reads current language');
            m.SetSong({...choices[0],RomanizedLanguage:'Korean'},choices,m.SongLyricsLoaded);check(!conversions.checked,'lyrics refresh reads new language');
            failStorage=true;conversions.checked=true;change(conversions);check(!conversions.checked&&quick.querySelector('[role=status]').textContent,'failed save restores live state');failStorage=false;
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(!shown().length&&document.activeElement===quickButton&&quickButton.getAttribute('aria-expanded')==='false','Escape closes and restores focus');
            click(providerButton);click(provider.querySelector('h3'));check(provider.matches(':popover-open'),'inside click never closes');click(document.body);check(!shown().length,'outside click closes');
            click(providerButton);click(providerButton);check(!shown().length,'trigger toggles closed');
            click(quickButton);click(second.buttons[0]);check(shown().length===1&&second.panels[0].matches(':popover-open'),'only one menu across overlapping surfaces');
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            // Keep an open menu during native fullscreen entry; the CDP hook
            // supplies a trusted user gesture, rather than faking fullscreenElement.
            click(quickButton);window.fixtureReady=true;await new Promise(resolve=>window.fixtureFullscreen=resolve);await frame();
            check(document.fullscreenElement===first.host,'real fullscreen entered');
            check(document.fullscreenElement.contains(quick)&&quick.matches(':popover-open'),'menu renders within fullscreen element');
            const bounds=quick.getBoundingClientRect();check(bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,'menu stays inside viewport');
            // Simulate the fullscreen-only view being disposed on exit. The
            // deferred All settings action must still open its modal afterwards.
            document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)first.maid.Destroy()},{once:true});
            click(button(quick,'All settings'));await frame();await frame();
            check(!document.fullscreenElement&&form?.isConnected&&!shown().length,'All settings exits fullscreen before opening modal after view disposal');
          }
          modal.remove();for(const view of mounted)view.maid.Destroy();
          check(!document.querySelector('.BL-CornerControls,.BL-CornerMenu:popover-open'),'Maid removes DOM and open popovers');
          check(m.SongChanged.size===0&&m.SongLyricsLoaded.size===0,'Maid disconnects song signals');
          check(tooltips.slice(0,4).every(t=>t.destroyed),'Maid destroys corner tooltips');
          const writes=data.size;m.SongChanged.fire();m.SongLyricsLoaded.fire();click(first.buttons[1]);check(!shown().length&&data.size===writes,'disposed listeners cannot reopen menus');
          fixtureGlobalMaid.Destroy();document.title='CORNER_CONTROLS_PASS';
        }catch(error){document.title='CORNER_CONTROLS_FAIL '+error.stack;window.fixtureReady=true}
        window.jelTestComplete(document.title);
      });`;
      assert.doesNotMatch(script,/[^\x00-\x7f]/,'fixture scripts remain ASCII without a charset');
      const file=path.join(directory,'fixture-'+future+'.html');
      await writeFile(file,'<!doctype html><style>'+css+'</style><body><script>'+script.replaceAll('</script','<\\/script')+'</script>');
      const result=await runFocusedFixture(chrome,file,path.join(directory,'profile-'+future),future?undefined:async send=>{
        await send('Runtime.evaluate',{expression:'new Promise(resolve=>{const wait=()=>window.fixtureReady?resolve():requestAnimationFrame(wait);wait()})',awaitPromise:true});
        const title=await send('Runtime.evaluate',{expression:'document.title'});
        assert.doesNotMatch(title.result.value,/CORNER_CONTROLS_FAIL/,title.result.value);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
        const focus=await send('Runtime.evaluate',{expression:'document.activeElement.getAttribute("aria-label")'});
        assert.equal(focus.result.value,'Increase text size','native Tab reaches the next enabled control in DOM order');
        const entered=await send('Runtime.evaluate',{expression:'document.querySelector(".Root__main-view").requestFullscreen()',userGesture:true,awaitPromise:true});
        assert.ok(!entered.exceptionDetails,JSON.stringify(entered.exceptionDetails));
        await send('Runtime.evaluate',{expression:'window.fixtureFullscreen()'});
      });
      assert.match(result,/CORNER_CONTROLS_PASS/,result);
    }
  }finally{
    assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('jel-corners-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3});
  }
});
