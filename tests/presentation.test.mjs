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
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 6, profiles: {} }) });
  const future = CreatePresentationSettings(storage);
  assert.equal(future.isReadOnly(), true);
  assert.throws(() => future.setRomanized('FullLyrics', 'Japanese', true), /newer version/);
  assert.equal(JSON.parse(storage.getItem(key)).version, 6);
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
  assert.equal(JSON.parse(storage.getItem(key)).version, 5);
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
  assert.equal(JSON.parse(storage.getItem(key)).version,5);
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
