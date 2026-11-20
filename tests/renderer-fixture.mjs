import { build } from 'esbuild';
import * as sass from 'sass';
import path from 'node:path';
import {readFile} from 'node:fs/promises';

// Shared by standalone Chromium tests and the private parent-run native fixture.
// It bundles real components/layout, without player/session/storage dependencies.
export async function buildVocalFixture(baselineRoot, includeScroller = false, realConverters = false, includeLayout = false, includeRenderer = false, includeCard = false) {
  const baseline = baselineRoot ? ['SyllableVocals','LineVocals','Interlude'].map((name,index)=>`export {default as ${['Baseline','BaselineLine','BaselineInterlude'][index]}} from ${JSON.stringify(path.join(baselineRoot, 'Extension/Source/Modules/LyricsRenderer/Components/'+name+'.ts').replaceAll('\\','/'))};`).join('\n') : '';
  const result = await build({ stdin: { contents: `
    ${includeScroller ? "export {LyricsScroller} from './Extension/Source/Modules/LyricsRenderer/LyricsScroller.ts';" : ''}
    ${includeLayout ? "export * from './Extension/Source/LayoutSettings.ts';export {PresentationSettings} from './Extension/Source/PresentationSettings.ts';export * from './Extension/Source/Modules/LyricsRenderer/TypographyPreview.ts';" : ''}
    ${includeRenderer ? "export {default as LyricsRenderer} from './Extension/Source/Modules/LyricsRenderer.ts';" : ''}
    ${includeCard ? "export {default as CardView} from './Extension/Source/LyricViews/Card/mod.ts';export {Store} from './Extension/Source/LyricViews/Shared.ts';export {SetSong} from '@Spices/Spicetify/Services/Player/mod.ts';" : ''}
    export {VocalController} from './Extension/Source/Modules/LyricsRenderer/VocalController.ts';
    export {CueController} from './Extension/Source/Modules/LyricsRenderer/CueController.ts';
    export {RenderScheduler} from './Extension/Source/Modules/LyricsRenderer/RenderScheduler.ts';
    export {EffectCurve} from './Extension/Source/Modules/LyricsRenderer/RenderEffects.ts';
    export {RunAnnotationLayout} from './Extension/Source/Modules/LyricsRenderer/AnnotationLayout.ts';
    export * from './Extension/Source/RenderingSettings.ts';
    export * from './Extension/Source/AnnotationSettings.ts';
    export {JoinDisplayRuns,ResolveDetail} from './Extension/Source/Modules/RenderProjection.ts';
    export {default as Current} from './Extension/Source/Modules/LyricsRenderer/Components/SyllableVocals.ts';
    export {LayoutSyllables,LayoutVoice,BuildVoiceText} from './Extension/Source/Modules/TextLayout.ts';
    export {NormalizeLyrics} from './Extension/Source/Modules/LyricDocument.ts';
    export {AlignJapanese,ConvertVoice} from './Extension/Source/Modules/AnnotationConverters.ts';${baseline}`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'fixtureModule', plugins: [{ name: 'isolated-vocals', setup(b) {
      if(includeRenderer)b.onResolve({filter:/LyricClock\.ts$/},()=>({path:'fixture-clock',namespace:'clock'}));
      b.onLoad({filter:/.*/,namespace:'clock'},()=>({contents:includeCard ? 'export const PlayerLyricClock=globalThis.fixtureClock;' : 'export const PlayerLyricClock={};'}));
      if(includeCard) {
        b.onResolve({filter:/Player\/mod\.ts$/},()=>({path:'player',namespace:'card-host'}));
        b.onResolve({filter:/Services\/Cache\.ts$/},()=>({path:'cache',namespace:'card-host'}));
        b.onResolve({filter:/BackgroundController\.ts$/},()=>({path:'background',namespace:'card-host'}));
        b.onLoad({filter:/.*/,namespace:'card-host'},args=>({contents:args.path==='player'
          ? 'export let SongLyrics;export const Song=undefined,SongContext=undefined;export function SetSong(lyrics){SongLyrics=lyrics}'
          : args.path==='background' ? 'export default class BackgroundController{SetOnScreen(){} Destroy(){}}'
          : 'export const GetInstantStore=(key,version,defaults)=>({Items:JSON.parse(localStorage.getItem(key)||"null")?.Items||defaults,SaveChanges(){throw Error("Unexpected legacy store write")}});'}));
      }
      b.onResolve({ filter: /^@|^npm:/ }, args => {
        if (args.importer.endsWith('AnnotationConverters.ts') && (!realConverters || args.path.includes('KuromojiAnalyzer'))) return { path: 'unused-language', namespace: 'fixture' };
        if (args.path.startsWith('@Universal/')) return { path: path.resolve('Universal', args.path.slice('@Universal/'.length)) };
        if (args.path.startsWith('@Spices/')) return { path: path.resolve('Extension/Spices', args.path.slice('@Spices/'.length)) };
        if (args.path.startsWith('@Pinyin/')) return { path: path.resolve('Pinyin', args.path.slice('@Pinyin/'.length)) };
        if (args.path.startsWith('npm:')) return b.resolve(args.path.slice(4).replace(/@[^/@]+$/, ''), { resolveDir: process.cwd(), kind: args.kind });
      });
      b.onLoad({ filter: /\.(?:css|scss)$/ }, () => ({contents:'',loader:'js'}));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default {};' }));
    } }] });
  const scrollerCSS = includeScroller || includeRenderer ? await readFile('Extension/Source/Simplebar/style.css', 'utf8') : '';
  return { code: result.outputFiles[0].text, css: scrollerCSS + sass.compile('Extension/Source/Stylings/Lyrics.scss').css };
}

export const shapingCases = [
  { name: 'Thai clusters', text: ['ก', 'ิ', 'ดี', 'ก', '้', 'กุ'] },
  { name: 'Latin combining', text: ['e', '\u0301', 'x'] },
  { name: 'Emoji ZWJ', text: ['👩', '\u200d', '💻', '!'] },
  { name: 'Arabic shaping', text: ['س', 'لا', 'م'] },
  { name: 'Indic shaping', text: ['क', '्', 'ष'] },
  { name: 'CJK retained', text: ['花', '空'] },
];
