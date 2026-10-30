import type { LyricVoice } from "./LyricDocument.ts";
import type { AnnotationLanguage, AnnotationOptions } from "./AnnotationService.ts";
import { BuildVoiceText, CreateDisplayRun, LayoutVoice, type DisplayRun } from "./TextLayout.ts";

export type JapaneseToken = { surface_form: string; reading?: string; pronunciation?: string; pos?: string; pos_detail_1?: string; pos_detail_2?: string; pos_detail_3?: string };
// The analyzer and dictionary are shared across options/jobs. Failed startup can
// be retried later; individual consumer cancellation does not corrupt its state.
let analyzerReady: Promise<void> | undefined;

// Normalize analysis punctuation only. UTF16 boundaries explicitly map back to
// original source text so neither displayed punctuation nor timing is rewritten.
export function JapaneseAnalysis(text: string) {
  let analysis = ""; const originalOffsets = [0];
  for (let index = 0; index < text.length; index++) {
    analysis += text[index] === "(" ? "（" : text[index] === ")" ? "）" : text[index];
    originalOffsets.push(index + 1);
  }
  return { text: analysis, originalOffsets };
}
// Attach readings only when written kana anchors admit one complete alignment.
// Compounds remain grouped; ambiguous okurigana stays safely on the baseline.
export function FuriganaRanges(surface: string, kana: string, start: number, toKana: (text: string) => string) {
  if (surface.length > 1024 || kana.length > 1024) return [];
  const chunks = [...surface.matchAll(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)];
  if (chunks.length > 128) return [];
  let visits = 0, exhausted = false;
  const safeEnds = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(kana)].map(part => part.index + part.segment.length);
  const solutions: { text: string; start: number; end: number }[][] = [];
  const walk = (part: number, offset: number, ranges: { text: string; start: number; end: number }[]) => {
    if (++visits > 512) { exhausted = true; return; }
    if (solutions.length > 1 || exhausted) return;
    if (part === chunks.length) { if (offset === kana.length) solutions.push(ranges); return; }
    const chunk = chunks[part], text = chunk[0];
    if (!/\p{Script=Han}/u.test(text)) { const anchor = toKana(text) || text.replace(/[ァ-ヶ]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60)); if (kana.startsWith(anchor, offset)) walk(part + 1, offset + anchor.length, ranges); return; }
    for (const end of safeEnds.filter(end => end > offset)) walk(part + 1, end, [...ranges, { text: kana.slice(offset, end), start: start + chunk.index!, end: start + chunk.index! + text.length }]);
  };
  walk(0, 0, []);
  return !exhausted && solutions.length === 1 ? solutions[0] : [];
}
export function AlignJapanese(voice: LyricVoice, tokens: readonly JapaneseToken[], form: "romaji" | "kana", convert: (reading: string, form: "romaji" | "kana") => string): readonly DisplayRun[] {
  const source = BuildVoiceText(voice);
  const analysis = JapaneseAnalysis(source.text);
  const output: DisplayRun[] = [];
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source.text)].map(segment => segment.index));
  boundaries.add(source.text.length);
  let cursor = 0;
  let pendingGap = "";
  for (const [tokenIndex, token] of tokens.entries()) {
    if (!token.surface_form) throw new Error("Empty token surface");
    // word_position is deliberately ignored: surrogate and punctuation offsets
    // differ across tokenizer builds. Match exact source surfaces sequentially.
    const analysisStart = analysis.text.indexOf(JapaneseAnalysis(token.surface_form).text, cursor);
    const start = analysis.originalOffsets[analysisStart] ?? -1;
    if (start < cursor || /\S/u.test(source.text.slice(cursor, start))) throw new Error("Uncertain token alignment");
    const end = analysis.originalOffsets[analysisStart + token.surface_form.length];
    const surface = source.text.slice(start, end);
    // A tokenizer's boundary is not automatically safe for combining marks or
    // emoji. Prefer the original safe projection over re-splitting a cluster.
    if (!boundaries.has(start) || !boundaries.has(end)) throw new Error("Unsafe token cluster boundary");
    const gap = source.text.slice(cursor, start);
    if (!/\S/u.test(token.surface_form)) {
      pendingGap += gap + token.surface_form;
      cursor = end;
      continue;
    }
    const ranges = source.ranges.filter(range => range.end > start && range.start < end)
      .map(range => ({ ...range, start: Math.max(start, range.start), end: Math.min(end, range.end) }));
    if (!ranges.length && /\S/u.test(token.surface_form)) throw new Error("Token has no source range");
    let orthographic = token.reading;
    let phonetic = token.pronunciation || orthographic;
    if (form === "romaji" && !phonetic) {
      // UNKNOWN dictionary entries can omit both readings even for written kana.
      // Compose dakuten only in this private conversion input: offsets/surfaces
      // and analyzer tokens remain exact. The utility supports these fullwidth
      // kana (excluding unsupported ゔ/ゕ/ゖ); other widths/extended kana
      // and unknown kanji stay unguessed.
      const writtenKana = surface.normalize("NFC");
      if (/^[ぁ-んァ-ヶー]+$/u.test(writtenKana) && /[ぁ-んァ-ヶ]/u.test(writtenKana)) phonetic = writtenKana;
    }
    const next = tokens[tokenIndex + 1];
    // Restrict the known temporal-noun suffix error to pronoun grammar. A name
    // suffix or unknown placeholder is not evidence for a global 君 replacement.
    if (surface === "君" && (orthographic === "クン" || phonetic === "クン") &&
      /^(?:(?:あの|この|その)?(?:夜|朝|夕|晩|時|日|頃))$/u.test(tokens[tokenIndex - 1]?.surface_form || "") &&
      next?.pos === "助詞" && /^(?:が|は|を|に|へ|と|の|も)$/u.test(next.surface_form) &&
      !tokens.slice(Math.max(0, tokenIndex - 2), tokenIndex).some(previous => previous.pos_detail_2 === "人名")) orthographic = phonetic = "キミ";
    // Written kana/particles remain orthographic; romaji uses pronunciation.
    const reading = form === "kana" ? orthographic : phonetic;
    const text = form === "kana" && !/\p{Script=Han}/u.test(surface) ? surface.replace(/[ァ-ヶ]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60)) : reading && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token.surface_form)
      ? convert(reading, form) : surface;
    const run = CreateDisplayRun(pendingGap + gap + text, ranges, false);
    // Reading/source spaces are explicit text. Each mapped token remains a wrap
    // opportunity rather than one unbreakable .Word covering the whole voice.
    run.ExplicitSpacing = true;
    run.AnnotationDerived = true;
    if (orthographic && /\p{Script=Han}/u.test(surface)) {
      run.Readings = FuriganaRanges(surface, convert(orthographic, "kana"), start, text => convert(text, "kana"));
      run.Reading = run.Readings[0];
    }
    // A reading inherits a token's source interval union, not fabricated phoneme
    // timings. No independent character emphasis on annotation mappings.
    run.SafeLetters = false;
    run.Precision = "grouped";
    if (form === "romaji" && output.length && !pendingGap && !gap && /\S$/u.test(output[output.length - 1].Text) && /^\p{Letter}/u.test(text)) output[output.length - 1].Text += " ";
    output.push(run);
    pendingGap = "";
    cursor = end;
  }
  const tail = source.text.slice(cursor);
  if (/\S/u.test(tail)) throw new Error("Unmatched token tail");
  if (output.length) output[output.length - 1].Text += pendingGap + tail;
  else if (source.text.trim()) throw new Error("No tokens");
  else return LayoutVoice(voice);
  return output;
}

export async function ConvertVoice(voice: LyricVoice, language: AnnotationLanguage, options: AnnotationOptions, signal: AbortSignal): Promise<readonly DisplayRun[]> {
  if (signal.aborted) return [];
  if (language === "Japanese") {
    const [analyzer, imported] = await Promise.all([
      import("@Spices/Spicetify/Services/Player/KuromojiAnalyzer.ts"), import("npm:@sglkc/kuroshiro@^1.0.1"),
    ]);
    if (signal.aborted) return [];
    analyzerReady ??= analyzer.init().catch(error => { analyzerReady = undefined; throw error; });
    await analyzerReady;
    if (signal.aborted) return [];
    const tokens = await analyzer.parse(JapaneseAnalysis(BuildVoiceText(voice).text).text);
    if (signal.aborted) return [];
    const util = imported.default.Util;
    return AlignJapanese(voice, tokens, options.japaneseForm, (reading, form) => form === "kana" ? util.kanaToHiragna(reading) : util.kanaToRomaji(reading, "hepburn"));
  }
  const runs = LayoutVoice(voice);
  const result: DisplayRun[] = [];
  for (const original of runs) {
    if (signal.aborted) return [];
    let text: string;
    if (language === "Chinese") {
      const { default: pinyin } = await import("@Pinyin/Source/main.ts");
      if (signal.aborted) return [];
      text = (await pinyin(original.Text, { segment: false, group: true })).join("-");
    } else {
      const { default: aromanize } = await import("@Spices/Spicetify/Services/Player/Aromanize.ts");
      if (signal.aborted) return [];
      text = aromanize(original.Text, "RevisedRomanizationTransliteration");
    }
    if (signal.aborted) return [];
    result.push({ ...original, Text: text, SafeLetters: false, Precision: "grouped", AnnotationDerived: true });
  }
  return result;
}
