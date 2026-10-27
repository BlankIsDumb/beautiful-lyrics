import { build } from 'esbuild';
import * as sass from 'sass';
import path from 'node:path';

// Shared by standalone Chromium tests and the private parent-run native fixture.
// It bundles real components/layout, without player/session/storage dependencies.
export async function buildVocalFixture(baselineRoot) {
  const baseline = baselineRoot ? `export {default as Baseline} from ${JSON.stringify(path.join(baselineRoot, 'Extension/Source/Modules/LyricsRenderer/Components/SyllableVocals.ts').replaceAll('\\', '/'))};` : '';
  const result = await build({ stdin: { contents: `
    export {default as Current} from './Extension/Source/Modules/LyricsRenderer/Components/SyllableVocals.ts';
    export {LayoutSyllables,LayoutVoice,BuildVoiceText} from './Extension/Source/Modules/TextLayout.ts';
    export {NormalizeLyrics} from './Extension/Source/Modules/LyricDocument.ts';
    export {AlignJapanese} from './Extension/Source/Modules/AnnotationConverters.ts';${baseline}`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'fixtureModule', plugins: [{ name: 'isolated-vocals', setup(b) {
      b.onResolve({ filter: /^@|^npm:/ }, args => {
        if (args.importer.endsWith('AnnotationConverters.ts')) return { path: 'unused-language', namespace: 'fixture' };
        if (args.path.startsWith('@Universal/')) return { path: path.resolve('Universal', args.path.slice('@Universal/'.length)) };
        if (args.path.startsWith('@Spices/')) return { path: path.resolve('Extension/Spices', args.path.slice('@Spices/'.length)) };
        if (args.path.startsWith('npm:')) return b.resolve(args.path.slice(4).replace(/@[^/@]+$/, ''), { resolveDir: process.cwd(), kind: args.kind });
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default {};' }));
    } }] });
  return { code: result.outputFiles[0].text, css: sass.compile('Extension/Source/Stylings/Lyrics.scss').css };
}

export const shapingCases = [
  { name: 'Thai clusters', text: ['ก', 'ิ', 'ดี', 'ก', '้', 'กุ'] },
  { name: 'Latin combining', text: ['e', '\u0301', 'x'] },
  { name: 'Emoji ZWJ', text: ['👩', '\u200d', '💻', '!'] },
  { name: 'Arabic shaping', text: ['س', 'لا', 'م'] },
  { name: 'Indic shaping', text: ['क', '्', 'ष'] },
  { name: 'CJK retained', text: ['花', '空'] },
];
