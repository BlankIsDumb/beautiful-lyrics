import type { LyricVoice } from "./LyricDocument.ts";
import type { AnnotationLanguage, AnnotationOptions } from "./AnnotationService.ts";
import { BuildVoiceText, CreateDisplayRun, LayoutVoice, type DisplayRun } from "./TextLayout.ts";

export type JapaneseToken = { surface_form: string; reading?: string; pronunciation?: string };
// The analyzer and dictionary are shared across options/jobs. Failed startup can
// be retried later; individual consumer cancellation does not corrupt its state.
let analyzerReady: Promise<void> | undefined;

export function AlignJapanese(voice: LyricVoice, tokens: readonly JapaneseToken[], form: "romaji" | "kana", convert: (reading: string, form: "romaji" | "kana") => string): readonly DisplayRun[] {
  const source = BuildVoiceText(voice);
  const output: DisplayRun[] = [];
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source.text)].map(segment => segment.index));
  boundaries.add(source.text.length);
  let cursor = 0;
  let pendingGap = "";
  for (const token of tokens) {
    if (!token.surface_form) throw new Error("Empty token surface");
    // word_position is deliberately ignored: surrogate and punctuation offsets
    // differ across tokenizer builds. Match exact source surfaces sequentially.
    const start = source.text.indexOf(token.surface_form, cursor);
    if (start < cursor || /\S/u.test(source.text.slice(cursor, start))) throw new Error("Uncertain token alignment");
    const end = start + token.surface_form.length;
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
    const reading = token.pronunciation || token.reading;
    const text = reading && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token.surface_form)
      ? convert(reading, form) : token.surface_form;
    const run = CreateDisplayRun(pendingGap + gap + text, ranges, false);
    // Reading/source spaces are explicit text. Each mapped token remains a wrap
    // opportunity rather than one unbreakable .Word covering the whole voice.
    run.ExplicitSpacing = true;
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
    const tokens = await analyzer.parse(BuildVoiceText(voice).text);
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
    result.push({ ...original, Text: text, SafeLetters: false, Precision: "grouped" });
  }
  return result;
}
