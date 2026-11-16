import type { Lyrics } from "@Universal/Types/Lyrics.ts";
import type { RichSyncSettings } from "../../Spices/Spicetify/Services/Player/ProviderSettings.ts";
import { DeriveCueCandidates, GetLyricDocument, HoldsRichSyncGap } from "./LyricDocument.ts";

type Analysis = { hasWordTiming: boolean; segmentsPerLine: number; gaps: ReturnType<typeof DeriveCueCandidates>; projection?: Lyrics };
const analysisCache = new WeakMap<Lyrics, Analysis>();

function Analyze(lyrics: Lyrics): Analysis {
  const cached = analysisCache.get(lyrics);
  if (cached) return cached;
  const document = GetLyricDocument(lyrics);
  let segments = 0, lines = 0;
  for (const group of document.groups) {
    const starts = new Set<number>();
    for (const voice of group.voices) for (const span of voice.spans) {
      if (span.Text.trim()) starts.add(Math.round(span.start! * 1000));
    }
    if (starts.size) { segments += starts.size; lines++; }
  }
  const result = { hasWordTiming: document.precision === "word", segmentsPerLine: lines ? segments / lines : Infinity, gaps: DeriveCueCandidates(document) };
  analysisCache.set(lyrics, result);
  return result;
}

export function SelectCompensatedLyrics<T extends Lyrics>(ranked: readonly T[], settings: RichSyncSettings, manualProvider?: string): T | undefined {
  const pinned = manualProvider && ranked.find(lyrics => lyrics.Source?.Provider === manualProvider);
  const winner = pinned || ranked[0];
  const source = winner?.Source;
  if (!winner || !source || !["Musixmatch", "LRCLIB", "Spotify"].includes(source.Provider) || winner.Type === "Static" || !(settings.holdSeconds || settings.minimumSegmentsPerLine)) return winner;

  const analysis = Analyze(winner);
  // Whole-line syllable wrappers are line sync too. The toggle only adds holds
  // for passing rich sync; resolution and the source's word precision stay intact.
  const line = analysis.hasWordTiming && analysis.segmentsPerLine < settings.minimumSegmentsPerLine;
  const hold = (!analysis.hasWordTiming || line || settings.holdWordSync) && settings.holdSeconds > 0 &&
    analysis.gaps.some(gap => HoldsRichSyncGap(gap, settings.holdSeconds));
  if (hold && !pinned) {
    // Candidates already have the normal rank and were prepared successfully.
    // Sparse fallback alone never changes their order or the Auto winner.
    const other = ranked.find(lyrics => lyrics.Source?.Provider !== source.Provider && lyrics.Source?.HasWordSync &&
      lyrics.Source.UniqueTimings >= source.UniqueTimings);
    if (other) return other;
  }
  if (!hold && !line) return winner;
  const effectiveWordSync = line ? false : source.HasWordSync;
  const holdSeconds = hold ? settings.holdSeconds : undefined;
  const previous = analysis.projection as T | undefined;
  if (previous && previous.Source?.HasWordSync === effectiveWordSync && previous.Source?.RichSyncHoldSeconds === holdSeconds) return previous;
  // Keep the timed spans and cache key for conversions, seeks and cue timing.
  // Only the selected view of the source changes its effective precision.
  const projected = { ...winner, Source: { ...source, HasWordSync: effectiveWordSync, RichSyncHoldSeconds: holdSeconds } };
  analysis.projection = projected;
  return projected;
}
