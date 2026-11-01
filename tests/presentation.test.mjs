import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = async entry => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm' });
  return result.outputFiles[0].text;
};
const presentationCode = await bundle('Extension/Source/PresentationSettings.ts');
const providerCode = await bundle('Extension/Spices/Spicetify/Services/Player/ProviderSettings.ts');
let serial = 0;
const load = code => import('data:text/javascript;base64,' + Buffer.from(code + `\n// ${serial++}`).toString('base64'));
const { CreatePresentationSettings } = await load(presentationCode);
const key = 'JustEnoughLyrics/Presentation';
const legacyKey = 'BeautifulLyrics/LyricViews';
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
}
const languages = { Chinese: false, Japanese: true, Korean: false };

test('shared legacy languages seed independent profiles without rewriting rollback state', () => {
  const old = JSON.stringify({ Version: 1, Items: { CardLyricsVisible: true, RomanizedLanguages: languages } });
  const storage = memoryStorage({ [legacyKey]: old });
  const settings = CreatePresentationSettings(storage);
  assert.deepEqual(settings.getProfile('NowPlaying').romanizedLanguages, languages);
  assert.deepEqual(settings.getProfile('FullLyrics').romanizedLanguages, languages);
  settings.setRomanized('NowPlaying', 'Japanese', false);
  assert.equal(settings.isRomanized('FullLyrics', 'Japanese'), true);
  assert.equal(storage.getItem(legacyKey), old);
  const reopened = CreatePresentationSettings(storage);
  assert.equal(reopened.isRomanized('NowPlaying', 'Japanese'), false);
  assert.equal(reopened.isRomanized('FullLyrics', 'Japanese'), true);
});

test('profile edits notify only once, ignore no-op saves and dispose subscriptions', () => {
  const settings = CreatePresentationSettings(memoryStorage());
  const events = [];
  const changed = [];
  const stop = settings.subscribe((view, languages) => { events.push(view); changed.push(languages); });
  settings.saveLanguages('FullLyrics', languages);
  settings.saveLanguages('FullLyrics', languages);
  settings.setRomanized('NowPlaying', 'Korean', true);
  assert.deepEqual(events, ['FullLyrics', 'NowPlaying']);
  assert.deepEqual(changed, [['Japanese'], ['Korean']]);
  stop();
  settings.resetLanguages('FullLyrics');
  assert.deepEqual(events, ['FullLyrics', 'NowPlaying']);
  assert.equal(settings.isRomanized('NowPlaying', 'Korean'), true);
  assert.equal(settings.isRomanized('FullLyrics', 'Japanese'), false);
});

test('draft reads cannot mutate active profiles and malformed values use Classic', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 1, profiles: {
    NowPlaying: { romanizedLanguages: { Japanese: 'true', Korean: true } },
  } }) });
  const settings = CreatePresentationSettings(storage);
  const draft = settings.getProfile('NowPlaying');
  draft.romanizedLanguages.Korean = false;
  assert.equal(settings.isRomanized('NowPlaying', 'Korean'), true);
  assert.equal(settings.isRomanized('NowPlaying', 'Japanese'), false);
  assert.equal(settings.isRomanized('FullLyrics', 'Korean'), false);
  assert.equal(CreatePresentationSettings(memoryStorage({ [key]: '{bad' })).isRomanized('FullLyrics', 'Japanese'), false);
});

test('failed persistence and unknown future schemas leave state and notifications intact', () => {
  const settings = CreatePresentationSettings({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  let events = 0;
  settings.subscribe(() => events++);
  assert.throws(() => settings.setRomanized('NowPlaying', 'Japanese', true), /quota/);
  assert.equal(settings.isRomanized('NowPlaying', 'Japanese'), false);
  assert.equal(events, 0);
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 99, profiles: {} }) });
  const future = CreatePresentationSettings(storage);
  assert.equal(future.isReadOnly(), true);
  assert.throws(() => future.setRomanized('FullLyrics', 'Japanese', true), /newer version/);
  assert.equal(JSON.parse(storage.getItem(key)).version, 99);
});

test('master Off remembers choices, persists independently and notifies only effective language changes', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 1, profiles: {
    NowPlaying: { romanizedLanguages: languages }, FullLyrics: { romanizedLanguages: languages },
  } }) });
  const settings = CreatePresentationSettings(storage);
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, true);
  const events = [];
  settings.subscribe((view, languages) => events.push([view, languages]));
  const draft = settings.getProfile('NowPlaying');
  draft.romanizationEnabled = false;
  settings.saveProfile('NowPlaying', draft);
  assert.equal(settings.isRomanized('NowPlaying', 'Japanese'), false);
  assert.equal(settings.getProfile('NowPlaying').romanizedLanguages.Japanese, true);
  assert.equal(settings.isRomanized('FullLyrics', 'Japanese'), true);
  assert.deepEqual(events, [['NowPlaying', ['Japanese']]]);
  // Changing a remembered choice while disabled must not rebuild lyric text.
  draft.romanizedLanguages.Korean = true;
  settings.saveProfile('NowPlaying', draft);
  assert.deepEqual(events.at(-1), ['NowPlaying', []]);
  const reopened = CreatePresentationSettings(storage);
  assert.equal(reopened.getProfile('NowPlaying').romanizationEnabled, false);
  assert.equal(JSON.parse(storage.getItem(key)).version, 8);
  draft.romanizationEnabled = true;
  reopened.saveProfile('NowPlaying', draft);
  assert.equal(reopened.isRomanized('NowPlaying', 'Japanese'), true);
  assert.equal(reopened.isRomanized('NowPlaying', 'Korean'), true);
});

test('inline romanization enables the master and Classic reset clears only its own profile', () => {
  const settings = CreatePresentationSettings(memoryStorage());
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, false);
  settings.setRomanized('NowPlaying', 'Japanese', true);
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, true);
  const disabled = settings.getProfile('NowPlaying');
  disabled.romanizationEnabled = false;
  settings.saveProfile('NowPlaying', disabled);
  settings.setRomanized('NowPlaying', 'Japanese', true);
  assert.equal(settings.isRomanized('NowPlaying', 'Japanese'), true);
  settings.setRomanized('FullLyrics', 'Korean', true);
  settings.resetLanguages('NowPlaying');
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, false);
  assert.equal(settings.getProfile('NowPlaying').romanizedLanguages.Japanese, false);
  assert.equal(settings.isRomanized('FullLyrics', 'Korean'), true);
});

test('presentation and demand edits never fire source invalidation; credentials/providers still do', async () => {
  globalThis.localStorage = memoryStorage();
  const providers = await load(providerCode);
  const presentation = await load(presentationCode);
  let reloads = 0, demandChanges = 0;
  const stopReload = providers.OnProviderSettingsChanged(() => reloads++);
  const stopDemand = providers.OnBehaviorSettingsChanged(() => demandChanges++);
  let behavior = providers.GetBehaviorSettings();
  presentation.PresentationSettings.setRomanized('FullLyrics', 'Japanese', true);
  behavior = { ...behavior, sidebarEnabled: false };
  providers.SaveProviderSettings('', behavior);
  behavior = { ...behavior, fetchMode: 'required' };
  providers.SaveProviderSettings('', behavior);
  assert.equal(reloads, 0);
  assert.equal(demandChanges, 2);
  providers.SaveProviderSettings('test-token', behavior);
  providers.SaveProviderSettings('test-token', { ...behavior, providers: { ...behavior.providers, Spotify: false } });
  assert.equal(reloads, 2);
  assert.equal(demandChanges, 2);
  stopReload(); stopDemand();
  providers.SaveProviderSettings('', { ...behavior, sidebarEnabled: true });
  assert.equal(reloads, 2);
  assert.equal(demandChanges, 2);
});

test('schema2 retains original/romanized defaults and schema3 remembers Kana through inline toggles', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 2, profiles: {
    NowPlaying: { romanizationEnabled: false, romanizedLanguages: languages },
    FullLyrics: { romanizationEnabled: true, romanizedLanguages: languages },
  } }) });
  const settings = CreatePresentationSettings(storage);
  assert.equal(settings.getProfile('NowPlaying').japaneseForm, 'romaji');
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, false);
  assert.equal(settings.isRomanized('FullLyrics', 'Japanese'), true);
  const events = [];
  settings.subscribe((view, languages) => events.push([view, languages]));
  settings.saveProfile('NowPlaying', { ...settings.getProfile('NowPlaying'), japaneseForm: 'kana' });
  assert.deepEqual(events.at(-1), ['NowPlaying', []]); // Off remembers style with no work.
  settings.setRomanized('NowPlaying', 'Japanese', true);
  assert.equal(settings.getProfile('NowPlaying').japaneseForm, 'kana');
  assert.deepEqual(events.at(-1), ['NowPlaying', ['Japanese']]);
  settings.setRomanized('NowPlaying', 'Japanese', false);
  settings.setRomanized('NowPlaying', 'Japanese', true);
  assert.equal(settings.getProfile('NowPlaying').japaneseForm, 'kana');
  settings.saveLanguages('NowPlaying', languages);
  assert.equal(settings.getProfile('NowPlaying').japaneseForm, 'kana');
  settings.saveProfile('NowPlaying', { ...settings.getProfile('NowPlaying'), japaneseForm: 'romaji' });
  assert.deepEqual(events.at(-1), ['NowPlaying', ['Japanese']]);
  assert.equal(CreatePresentationSettings(storage).getProfile('NowPlaying').japaneseForm, 'romaji');
  settings.resetLanguages('NowPlaying'); // Category reset intentionally restores Original/Romaji.
  assert.equal(settings.getProfile('NowPlaying').romanizationEnabled, false);
  assert.equal(settings.getProfile('NowPlaying').japaneseForm, 'romaji');
  assert.equal(settings.isRomanized('FullLyrics', 'Japanese'), true);
});


test('schema4 rendering edits preserve language/form and notify a separate view channel', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({version:3,profiles:{NowPlaying:{romanizationEnabled:true,japaneseForm:'kana',romanizedLanguages:languages}}}) });
  const settings = CreatePresentationSettings(storage), events=[], languagesChanged=[];
  const stop=settings.subscribeRendering((...args)=>events.push(args));
  settings.subscribe((...args)=>languagesChanged.push(args));
  const original=settings.getProfile('NowPlaying');
  assert.equal(original.renderingCases.Word.preset,'classic');
  settings.saveRendering('NowPlaying', 'Word',{...original.renderingCases.Word,highlight:'off',glow:false});
  assert.equal(events.length,1);assert.equal(languagesChanged.length,0);
  assert.equal(settings.getProfile('NowPlaying').renderingCases.Word.preset,'custom');
  assert.equal(settings.getProfile('NowPlaying').japaneseForm,'kana');
  settings.setRomanized('NowPlaying','Korean',true);
  settings.saveLanguages('NowPlaying',languages);
  assert.equal(events.length,1);
  assert.equal(settings.getProfile('NowPlaying').renderingCases.Word.highlight,'off');
  assert.equal(settings.getProfile('FullLyrics').renderingCases.Word.highlight,'classic');
  const reopened=CreatePresentationSettings(storage);
  assert.equal(reopened.getProfile('NowPlaying').renderingCases.Word.preset,'custom');
  assert.equal(reopened.getProfile('NowPlaying').japaneseForm,'kana');
  stop();settings.saveRendering('FullLyrics', 'Word',{...original.renderingCases.Word,blur:false});assert.equal(events.length,1);
});


test('schema5 defaults and v4 migration split four independent text cases without losing edits or universal cues', () => {
  const classic={detail:'auto',preset:'classic',highlight:'classic',scale:true,verticalMotion:true,glow:true,blur:true,emphasis:true,cueAnimation:true};
  const storage=memoryStorage({[key]:JSON.stringify({version:4,profiles:{NowPlaying:{rendering:classic},FullLyrics:{rendering:{...classic,preset:'custom',glow:false,cueAnimation:false},japaneseForm:'kana'}}})});
  const raw=storage.getItem(key),settings=CreatePresentationSettings(storage);
  assert.equal(settings.getRendering('NowPlaying','Word').preset,'classic');
  assert.equal(settings.getRendering('NowPlaying','Line').preset,'balanced');
  assert.equal(settings.getRendering('NowPlaying','Line').detail,'line');
  assert.equal(settings.getRendering('NowPlaying','Line').glow,false);
  assert.deepEqual(settings.getRendering('FullLyrics','Word'),settings.getRendering('FullLyrics','Line'));
  assert.equal(settings.getRendering('FullLyrics','Word').glow,false);
  assert.equal(settings.getCues('FullLyrics').motion,false);
  assert.equal(settings.getCues('NowPlaying').motion,true);
  assert.equal(settings.getProfile('FullLyrics').japaneseForm,'kana');
  assert.equal(storage.getItem(key),raw); // Migration is read-only until a real edit.
  const events=[],cueEvents=[];settings.subscribeRendering((...args)=>events.push(args));settings.subscribeCues((...args)=>cueEvents.push(args));
  settings.saveCues('NowPlaying',{threshold:100,motion:false});
  assert.equal(events.length,0);assert.equal(cueEvents.length,1);
  settings.saveRendering('NowPlaying','Word',{...settings.getRendering('NowPlaying','Word'),glow:false});
  assert.equal(events.length,1);assert.equal(events[0][1],'Word');assert.equal(cueEvents.length,1);
  assert.equal(settings.getRendering('NowPlaying','Line').preset,'balanced');
  const draft=settings.getProfile('NowPlaying');settings.saveProfile('NowPlaying',{...draft,japaneseForm:'kana'});draft.renderingCases.Word.glow=true;
  assert.equal(settings.getRendering('NowPlaying','Word').glow,false); // Detached save boundary.
  assert.deepEqual(settings.getCues('NowPlaying'),{threshold:100,motion:false});
  assert.equal(JSON.parse(storage.getItem(key)).version,8);
});

test('schema5 partial/corrupt Line maps use muted defaults and edited v4 presets/detail survive both cases', () => {
  const partial=CreatePresentationSettings(memoryStorage({[key]:JSON.stringify({version:5,profiles:{NowPlaying:{renderingCases:{Word:{glow:false}}},FullLyrics:{renderingCases:{Line:{glow:'bad'}}}}})}));
  assert.equal(partial.getRendering('NowPlaying','Line').preset,'balanced');
  assert.equal(partial.getRendering('FullLyrics','Line').glow,false);
  assert.equal(partial.getRendering('FullLyrics','Line').scale,false);
  for(const old of [{preset:'minimal',highlight:'off',scale:false,verticalMotion:false,glow:false,blur:false,emphasis:false}, {detail:'line'}, {preset:'custom'}]) {
    const settings=CreatePresentationSettings(memoryStorage({[key]:JSON.stringify({version:4,profiles:{NowPlaying:{rendering:old}}})}));
    assert.deepEqual(settings.getRendering('NowPlaying','Word'),settings.getRendering('NowPlaying','Line'));
  }
});


test('schema6 annotations preserve primary choices and isolate views, cases, channels and legacy helpers', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({ version:5, profiles:{NowPlaying:{romanizationEnabled:true,romanizedLanguages:{Japanese:true},japaneseForm:'kana',renderingCases:{Word:{highlight:'off',glow:false}},cues:{threshold:13,motion:false}}} }) });
  const settings=CreatePresentationSettings(storage), original=settings.getProfile('NowPlaying');
  assert.equal(original.annotations.secondary,'off');assert.equal(original.annotations.ruby,false);
  assert.equal(original.japaneseForm,'kana');assert.equal(settings.isRomanized('NowPlaying','Japanese'),true);
  assert.equal(storage.getItem(key).includes('"version":5'),true);
  let primary=0,render=0,cues=0,annotations=0;
  settings.subscribe(()=>primary++);settings.subscribeRendering(()=>render++);settings.subscribeCues(()=>cues++);settings.subscribeAnnotations(()=>annotations++);
  settings.saveAnnotations('NowPlaying',settings.getAnnotations('NowPlaying'));assert.equal(annotations,0);
  const next=settings.getAnnotations('NowPlaying');next.secondary='romaji';next.ruby=true;next.cases.Word={inherit:false,effects:{...original.renderingCases.Word,scale:false,emphasis:false}};
  settings.saveAnnotations('NowPlaying',next);
  assert.equal(primary+render+cues,0);assert.equal(annotations,1);assert.equal(settings.getAnnotations('FullLyrics').secondary,'off');
  assert.equal(settings.getAnnotations('NowPlaying').cases.Line.inherit,true);
  assert.deepEqual(settings.getProfile('NowPlaying').renderingCases,original.renderingCases);assert.deepEqual(settings.getCues('NowPlaying'),original.cues);
  settings.setRomanized('NowPlaying','Japanese',false);settings.saveLanguages('NowPlaying',{Chinese:true});settings.resetLanguages('NowPlaying');
  assert.deepEqual(settings.getAnnotations('NowPlaying'),next);assert.equal(annotations,1);
  const copy=settings.getAnnotations('NowPlaying');copy.cases.Line.inherit=false;assert.equal(settings.getAnnotations('NowPlaying').cases.Line.inherit,true);
  settings.saveAnnotations('NowPlaying',{...next,secondarySize:NaN,rubySize:10,gap:-1,spacing:Infinity,opacity:2,cases:{Word:{inherit:false},Line:{inherit:false}}});
  const valid=settings.getAnnotations('NowPlaying');assert.equal(valid.secondarySize,.6);assert.equal(valid.rubySize,.5);assert.equal(valid.gap,.15);assert.equal(valid.opacity,.8);
  assert.equal(valid.cases.Line.effects.scale,false);assert.equal(valid.cases.Line.effects.glow,false);
  assert.equal(JSON.parse(storage.getItem(key)).version,8);
});


test('schema7 migration is per-language, lazy, recoverable and preserves independent settings', () => {
  const raw=JSON.stringify({version:6,profiles:{NowPlaying:{romanizationEnabled:true,romanizedLanguages:{Japanese:true,Chinese:false,Korean:false},japaneseForm:'romaji',annotations:{secondary:'kana',ruby:true,rubySize:.8,alignment:'end'},cues:{threshold:9,motion:false},renderingCases:{Word:{glow:false},Line:{highlight:'off'}}},FullLyrics:{romanizationEnabled:false,romanizedLanguages:{Japanese:true},japaneseForm:'kana',annotations:{ruby:true,secondary:'romaji'}}}});
  const storage=memoryStorage({[key]:raw}),settings=CreatePresentationSettings(storage);
  const now=settings.getConversions('NowPlaying'),full=settings.getConversions('FullLyrics');
  assert.deepEqual(now.languages.Japanese,{enabled:true,kind:'romaji',placement:'replace'});
  assert.deepEqual(now.languages.Chinese,{enabled:true,kind:'pinyin',placement:'above'});
  assert.deepEqual(full.languages.Japanese,{enabled:true,kind:'furigana',placement:'replace'});
  assert.equal(full.languages.Korean.kind,'romaja');assert.equal(full.languages.Korean.placement,'above');
  assert.equal(storage.getItem(key),raw);assert.equal(storage.getItem(key+'/Migration/schema6'),null);
  settings.saveConversions('NowPlaying',now);assert.equal(storage.getItem(key),raw,'no-op is not a migration write');
  now.languages.Japanese.placement='above';settings.saveConversions('NowPlaying',now);
  assert.equal(storage.getItem(key+'/Migration/schema6'),raw);assert.equal(JSON.parse(storage.getItem(key)).version,8);
  assert.equal(settings.getCues('NowPlaying').threshold,9);assert.equal(settings.getAnnotations('NowPlaying').rubySize,.8);assert.equal(settings.getRendering('NowPlaying','Line').highlight,'off');
  const reopened=CreatePresentationSettings(storage);reopened.setRomanized('NowPlaying','Japanese',false);reopened.setRomanized('NowPlaying','Japanese',true);
  assert.equal(reopened.getConversions('NowPlaying').languages.Japanese.placement,'above');
  const choice=reopened.getConversions('NowPlaying');choice.enabled=false;reopened.saveConversions('NowPlaying',choice);assert.equal(reopened.isRomanized('NowPlaying','Japanese'),false);
  assert.equal(reopened.getConversions('FullLyrics').languages.Japanese.kind,'furigana');
  for(const failKey of [key,key+'/Migration/schema6']) {
    const failing=CreatePresentationSettings({getItem:k=>k===key?raw:null,setItem:k=>{if(k===failKey)throw Error('quota')}});let events=0;failing.subscribe(()=>events++);
    const next=failing.getConversions('NowPlaying');next.enabled=false;assert.throws(()=>failing.saveConversions('NowPlaying',next),/quota/);assert.equal(failing.getConversions('NowPlaying').enabled,true);assert.equal(events,0);
  }
});


test('schema6 master Off remembered non-Japanese flags do not activate when ruby forces the new master On',()=>{
  const raw=JSON.stringify({version:6,profiles:{NowPlaying:{romanizationEnabled:false,romanizedLanguages:{Japanese:true,Chinese:true,Korean:true},japaneseForm:'kana',annotations:{ruby:true,secondary:'off'}}}});
  const storage=memoryStorage({[key]:raw}),settings=CreatePresentationSettings(storage),converted=settings.getConversions('NowPlaying');
  assert.equal(converted.enabled,true);assert.equal(converted.languages.Japanese.kind,'furigana');
  assert.equal(settings.isRomanized('NowPlaying','Japanese'),true);assert.equal(settings.isRomanized('NowPlaying','Chinese'),false);assert.equal(settings.isRomanized('NowPlaying','Korean'),false);
  converted.languages.Japanese.placement='above';settings.saveConversions('NowPlaying',converted);assert.equal(storage.getItem(key+'/Migration/schema6'),raw);
});
