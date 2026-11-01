import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildVocalFixture, shapingCases } from './renderer-fixture.mjs';

const chrome = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
test('real vocal DOM preserves clusters, source granularity, narrow annotation wrapping and content lifetime', { skip: !chrome }, async () => {
  const { code, css } = await buildVocalFixture();
  const script = `(() => {${code}
    const {Current,LayoutSyllables,NormalizeLyrics,AlignJapanese,ClassicRendering}=fixtureModule;
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const spans=texts=>texts.map((Text,index)=>({Text,StartTime:index*2,EndTime:index*2+1.5,IsPartOfWord:true}));
    const instances=[];
    const make=(source,runs)=>{
      const shell=document.createElement('div');shell.className='shell';
      const lyrics=document.createElement('div');lyrics.className='Lyrics NaturallyAlignedLeft';shell.append(lyrics);
      const group=document.createElement('div');group.className='VocalsGroup';lyrics.append(group);document.body.append(shell);
      const vocal=new Current(group,source,false,false,runs);instances.push(vocal);vocal.Animate(.75,1/60,true);
      return {shell,group,vocal,container:group.querySelector('.Vocals')};
    };
    try {
      for(const sample of ${JSON.stringify(shapingCases)}) {
        const source=spans(sample.text),runs=LayoutSyllables(source),fixture=make(source,runs);
        check(fixture.container.textContent===sample.text.join(''),'exact source DOM '+sample.name);
        check(![...fixture.container.querySelectorAll('.Letter')].some(letter=>/^\\p{Mark}+$/u.test(letter.textContent)),'no isolated combining Letter '+sample.name);
        if(sample.name==='Thai clusters')check(runs.length===4,'Thai retains safe provider granularity');
        for(const time of [-1,0,.5,1.5,2,4,20,0])fixture.vocal.Animate(time,1/60,true);
        for(const element of fixture.container.querySelectorAll('[style]'))check(!/NaN|Infinity/.test(element.getAttribute('style')),'finite animation CSS '+sample.name);
      }
      // Pass6: oversized provider words wrap between safe units, without
      // shrinking each Thai chunk into a vertical column.
      const longThai=spans(['กิ','ดี','มาก','ก้','กุ','ไป','มา','ดี','กิ','ได้','ใจ','เรา','กัน']);
      longThai[longThai.length-1].IsPartOfWord=false;
      const oversized=make(longThai,LayoutSyllables(longThai));
      const longWord=oversized.container.querySelector('.Word');
      check(longWord&&longWord.getBoundingClientRect().width<=oversized.container.clientWidth+1,'oversized provider word stays in available width');
      check(new Set([...longWord.children].map(node=>Math.round(node.getBoundingClientRect().top))).size>1,'oversized word wraps to real visual rows');
      const lineHeight=parseFloat(getComputedStyle(oversized.container).lineHeight);
      for(const run of longWord.querySelectorAll('.ShapingRun')) {
        check(getComputedStyle(run).flexShrink==='0'&&getComputedStyle(run).whiteSpace==='pre-wrap','original run is atomic');
        check(run.getBoundingClientRect().height<=lineHeight*1.1+3,'Thai fragment never wraps internally into columns');
      }
      const wordSource=spans(['กิ','ดีมาก ','กุ','ดีมาก ','ก้','ดีมาก ']);
      wordSource.forEach((span,index)=>span.IsPartOfWord=index%2===0);
      for(const rightToLeft of [false,true]) {
        const fixture=make(wordSource,LayoutSyllables(wordSource));
        fixture.container.style.width='150px';
        fixture.group.classList.add('AlignedOpposite');
        if(rightToLeft){fixture.group.parentElement.classList.remove('NaturallyAlignedLeft');fixture.group.parentElement.classList.add('NaturallyAlignedRight')}
        const words=[...fixture.container.querySelectorAll('.Word')];
        check(words.length===3,'explicit source spaces preserve three original words');
        check(fixture.container.textContent===wordSource.map(span=>span.Text).join(''),'original spaces/text survive alignment');
        check(new Set(words.map(word=>Math.round(word.getBoundingClientRect().top))).size>1,'whole words move to another row');
        for(const word of words) {
          const tops=[...word.querySelectorAll('.ShapingRun')].map(run=>run.getBoundingClientRect().top);
          check(Math.max(...tops)-Math.min(...tops)<4,'word chunks stay on one row in opposite/RTL layouts');
        }
      }
      const short=[{Text:'e',StartTime:0,EndTime:.1,IsPartOfWord:true},{Text:'\\u0301',StartTime:5,EndTime:5.1,IsPartOfWord:false}];
      check(!make(short,LayoutSyllables(short)).container.querySelector('.Emphasis'),'silent envelope does not count as voiced emphasis duration');
      const source=Array.from({length:6},(_,index)=>({Text:'私は猫です。',StartTime:index*3,EndTime:index*3+2,IsPartOfWord:false}));
      const doc=NormalizeLyrics({Type:'Syllable',StartTime:0,EndTime:18,Content:[{Type:'Vocal',Lead:{StartTime:0,EndTime:18,Syllables:source}}]});
      const voice=doc.groups[0].voices[0];
      const tokens=Array.from({length:6},()=>[{surface_form:'私',reading:'ワタシ'},{surface_form:'は',reading:'ハ'},{surface_form:'猫',reading:'ネコ'},{surface_form:'です',reading:'デス'},{surface_form:'。'}]).flat();
      const fixture=make(source,LayoutSyllables(source)),identity=fixture.container;
      let clicks=0;fixture.vocal.RequestedTimeSkip.Connect(()=>clicks++);
      for(const form of ['romaji','kana']) {
        const maps=form==='romaji'?{ワタシ:'watashi',ハ:'ha',ネコ:'neko',デス:'desu'}:{ワタシ:'わたし',ハ:'は',ネコ:'ねこ',デス:'です'};
        const runs=AlignJapanese(voice,tokens,form,reading=>maps[reading]);
        const oldNodes=[...identity.querySelectorAll('.Syllable')];
        fixture.vocal.SetProjection(runs);fixture.vocal.Animate(4,0,true);
        check(fixture.group.querySelector('.Vocals')===identity,'vocal identity retained');
        check(oldNodes.every(node=>!node.isConnected),'old content nodes released');
        check(identity.textContent===runs.map(run=>run.Text).join(''),'mapped text complete '+form);
        check(identity.scrollWidth<=identity.clientWidth+1,'narrow260px no horizontal overflow '+form);
        check(identity.getBoundingClientRect().height>30,'annotation wraps '+form);
        for(const element of identity.querySelectorAll('.ExplicitSpacing'))check(getComputedStyle(element,'::after').content==='none','no duplicate CSS spacing '+form);
        for(const font of [18,32])for(const direction of ['Left','Right'])for(const opposite of [false,true])for(const scale of [false,true]){
          const lyrics=fixture.group.parentElement;lyrics.className='Lyrics NaturallyAligned'+direction;
          fixture.group.classList.toggle('AlignedOpposite',opposite);
          lyrics.style.setProperty('--minimum-lyrics-size',font+'px');lyrics.style.setProperty('--maximum-lyrics-size',font+'px');
          identity.setAttribute('data-jel-scale',scale?'on':'off');
          fixture.vocal.SetRendering({...ClassicRendering,scale});fixture.vocal.Animate(4,0,true);
          check(identity.scrollWidth<=identity.clientWidth+1,'converted owner scale envelope stays inside narrow row '+[form,font,direction,opposite,scale]);
          if(!scale)check([...identity.children].every(node=>getComputedStyle(node).maxWidth==='100%'),'Scale Off retains full wrap width');
        }
      }
      identity.click();check(clicks===1,'seek signal survives projection replacement without duplicate listener');
      fixture.vocal.Destroy();check(!identity.isConnected,'Destroy releases retained voice container');
      document.body.textContent='TEXT_LAYOUT_PASS';
    } catch(error) {document.body.textContent='TEXT_LAYOUT_FAIL: '+error.message}
    finally {for(const instance of instances)instance.Destroy()}
  })();`;
  const directory = path.resolve(await mkdtemp(path.join(tmpdir(), 'jel-text-')));
  try {
    const file = path.join(directory, 'fixture.html');
    await writeFile(file, `<!doctype html><body><style>${css}.shell{width:260px;container-type:inline-size}.Lyrics{width:260px;height:600px;--minimum-lyrics-size:24px;--maximum-lyrics-size:24px}.Vocals{max-width:100%}</style><script>${script.replaceAll('</script', '<\\/script')}</script>`);
    const browser = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(directory, 'profile'), '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000, windowsHide: true });
    assert.equal(browser.error, undefined, browser.error?.message);
    assert.equal(browser.status, 0, browser.stderr);
    assert.match(browser.stdout, /TEXT_LAYOUT_PASS/, browser.stdout);
    assert.doesNotMatch(browser.stdout, /TEXT_LAYOUT_FAIL/);
  } finally {
    assert.ok(directory.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith('jel-text-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
