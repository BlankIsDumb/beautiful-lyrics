import type { LyricDocument, LyricVoice } from "./LyricDocument.ts";
import type { SyllableMetadata, SyllableList } from "@Universal/Types/Lyrics.ts";

export type SourceRange = Readonly<{ spanId: string; start: number; end: number; startTime: number; endTime: number }>;
export type TimingInterval = Readonly<{ start: number; end: number }>;
export type DisplayRun = SyllableMetadata & {
  SourceRanges: readonly SourceRange[];
  Intervals: readonly TimingInterval[];
  TimingDuration: number;
  Precision: "source" | "grouped";
  SafeLetters: boolean;
  ExplicitSpacing?: boolean;
};
export type VoiceText = Readonly<{ text: string; ranges: readonly SourceRange[] }>;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : undefined;
const safeLetter = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const thaiLetter = /\p{Script=Thai}/u;
export const Graphemes = (text: string) => [...graphemes.segment(text)].map(segment => segment.segment);
export const SafeLetterAnimation = (text: string) => [...text].every(char => !/\p{Letter}/u.test(char) || safeLetter.test(char));
const needsShapingWord = (text: string) => [...text].some(char => /\p{Letter}/u.test(char) && !safeLetter.test(char) && !thaiLetter.test(char));

export function BuildVoiceText(voice: LyricVoice): VoiceText {
  // First inspect the raw concatenation, before interpreting word separators.
  // A provider may incorrectly mark a split base/combining-mark boundary as a
  // word end. Never inject whitespace inside that original grapheme cluster.
  const raw = voice.spans.map(span => span.Text).join("");
  const boundaries = new Set([...graphemes.segment(raw)].map(segment => segment.index));
  boundaries.add(raw.length);
  const ranges: SourceRange[] = [];
  let text = "", rawEnd = 0;
  voice.spans.forEach((span, index) => {
    const start = text.length;
    text += span.Text;
    rawEnd += span.Text.length;
    ranges.push({ spanId: span.id, start, end: text.length, startTime: span.start ?? 0, endTime: span.end ?? 0 });
    const next = voice.spans[index + 1];
    // IsPartOfWord describes THIS span continuing into NEXT (renderer semantics).
    // Separators are derived layout gaps, never timed or written to source spans.
    if (next && span.IsPartOfWord === false && boundaries.has(rawEnd) && !/\s$/u.test(span.Text) && !/^\s/u.test(next.Text)) text += " ";
  });
  return { text, ranges };
}

export function UnionIntervals(ranges: readonly SourceRange[]): readonly TimingInterval[] {
  const sorted = ranges.map(range => ({ start: range.startTime, end: range.endTime })).sort((a, b) => a.start - b.start || a.end - b.end);
  const union: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const previous = union[union.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else union.push(interval);
  }
  return union;
}

export function CreateDisplayRun(text: string, ranges: readonly SourceRange[], partOfWord: boolean): DisplayRun {
  const intervals = UnionIntervals(ranges);
  return {
    Text: text, IsPartOfWord: partOfWord,
    StartTime: intervals[0]?.start ?? 0, EndTime: intervals[intervals.length - 1]?.end ?? 0,
    SourceRanges: ranges, Intervals: intervals,
    TimingDuration: intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0),
    Precision: ranges.length > 1 ? "grouped" : "source", SafeLetters: SafeLetterAnimation(text),
  };
}

// No allocations, sort, layout reads or fabricated character timings per frame.
// Progress through a grouped unit freezes in true source gaps and counts overlap
// once. All original interval references remain on the run for provenance.
export function RunProgress(time: number, intervals: readonly TimingInterval[], duration: number): number {
  if (!intervals.length) return 0;
  if (duration === 0) return time >= intervals[intervals.length - 1].end ? 1 : 0;
  let elapsed = 0;
  for (const interval of intervals) {
    if (time < interval.start) break;
    elapsed += Math.min(time, interval.end) - interval.start;
    if (time <= interval.end) break;
  }
  return Math.max(0, Math.min(1, elapsed / duration));
}

export function LayoutVoice(voice: LyricVoice): readonly DisplayRun[] {
  const source = BuildVoiceText(voice);
  const boundary = new Set([...graphemes.segment(source.text)].map(segment => segment.index));
  boundary.add(source.text.length);
  const shaping = needsShapingWord(source.text);
  const wordBoundaries = new Set<number>([0, source.text.length]);
  if (shaping && words) for (const word of words.segment(source.text)) {
    wordBoundaries.add(word.index);
    wordBoundaries.add(word.index + word.segment.length);
  }
  const runs: DisplayRun[] = [];
  let first = 0;
  for (let index = 0; index < source.ranges.length; index++) {
    const range = source.ranges[index];
    const next = source.ranges[index + 1];
    const safeCluster = boundary.has(range.end);
    const separatingGap = !!next && source.text.slice(range.end, next.start).length > 0;
    // Thai keeps cluster-safe provider granularity, without letter emphasis.
    // Joining scripts coalesce within a word. If word segmentation cannot supply
    // a boundary, a real whitespace boundary is the conservative fallback.
    const safeWord = !shaping || separatingGap || /\s/u.test(source.text[range.end - 1] || "") || (words && wordBoundaries.has(range.end));
    if (next && (!safeCluster || !safeWord)) continue;
    const ranges = source.ranges.slice(first, index + 1);
    const start = ranges[0].start;
    const text = source.text.slice(start, range.end);
    // Preserve the provider's current-to-next word boundary, including explicit
    // whitespace and the final span. Coalescing only changes the visual unit;
    // it must not join separate source words merely because no gap was inserted.
    runs.push(CreateDisplayRun(text, ranges, voice.spans[index].IsPartOfWord === true));
    first = index + 1;
  }
  return runs;
}

// Compatibility entry for the existing component API and standalone fixtures.
export function LayoutSyllables(spans: SyllableList): readonly DisplayRun[] {
  return LayoutVoice({ id: "component", role: "lead", start: Math.min(...spans.map(span => span.StartTime)),
    end: Math.max(...spans.map(span => span.EndTime)), spans: spans.map((span, index) => ({ id: `component/s${index}`,
      Text: span.Text, start: span.StartTime, end: span.EndTime, IsPartOfWord: span.IsPartOfWord })) });
}

export function AnnotationFingerprint(document: LyricDocument): string {
  // CacheKey is an identity hint, not proof of identical immutable content.
  // Include actual source text/timing/joins, excluding all derived annotation.
  return JSON.stringify([document.type, document.groups.map(group => [group.oppositeAligned,
    group.voices.map(voice => [voice.role, voice.spans.map(span => [span.Text, span.start, span.end, span.IsPartOfWord])])])]);
}
