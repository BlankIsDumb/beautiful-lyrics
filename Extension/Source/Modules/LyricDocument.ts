import type { Lyrics, TextMetadata } from "@Universal/Types/Lyrics.ts";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type Interval = { start: number; end: number };
export type LyricSpan = Immutable<TextMetadata & { id: string; start?: number; end?: number; IsPartOfWord?: boolean }>;
export type LyricVoice = Immutable<Interval & { id: string; role: "lead" | "backing"; sourceInterval?: Interval; spans: LyricSpan[] }>;
export type LyricGroup = Immutable<{ id: string; oppositeAligned: boolean; voices: LyricVoice[] }>;
export type LyricDocument = Immutable<{
  version: 1; id: string; type: Lyrics["Type"]; precision: "static" | "line" | "word";
  start: number; end: number; groups: LyricGroup[];
  source?: Lyrics["Source"]; attribution?: Lyrics["Attribution"];
}>;
const documents = new WeakMap<Lyrics, LyricDocument>();
export function GetLyricDocument(source: Lyrics): LyricDocument {
  let document = documents.get(source);
  if (!document) { document = NormalizeLyrics(source); documents.set(source, document); }
  return document;
}

// Freeze detached data only: provider records and their caches remain untouched.
function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

export function NormalizeLyrics(lyrics: Lyrics): LyricDocument {
  const source = structuredClone(lyrics.Source);
  const rows = lyrics.Type === "Static" ? lyrics.Lines : lyrics.Content.filter(row => row.Type === "Vocal");
  // Positional IDs are deterministic within the selected provider document. They
  // deliberately exclude romanization and synthetic cues, so view edits cannot
  // change the identity of an original group/voice/span.
  let id = source?.CacheKey;
  if (!id) {
    // Source-less fixtures and older DTOs still need content identity. Only the
    // source rows/times participate; annotations and old derived cues do not.
    const identity = JSON.stringify({ type: lyrics.Type,
      start: lyrics.Type === "Static" ? undefined : lyrics.StartTime,
      end: lyrics.Type === "Static" ? undefined : lyrics.EndTime, rows,
    }, (key, value) => key === "RomanizedText" ? undefined : value);
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    id = `${source?.Provider || "unknown"}:${source?.TrackId || "local"}:${lyrics.Type}:${(hash >>> 0).toString(16)}`;
  }
  const groups: LyricGroup[] = [];
  rows.forEach((row: any, groupIndex) => {
    const groupId = `${id}/g${groupIndex}`;
    const parts = lyrics.Type === "Syllable" ? [row.Lead, ...(row.Background || [])] : [row];
    const voices = parts.map((part: any, voiceIndex: number) => {
      const voiceId = `${groupId}/v${voiceIndex}`;
      const spans: LyricSpan[] = (lyrics.Type === "Syllable" ? part.Syllables : [part]).map((span: any, spanIndex: number) => ({
        id: `${voiceId}/s${spanIndex}`, Text: span.Text,
        ...(lyrics.Type === "Static" ? {} : { start: span.StartTime, end: span.EndTime }),
        ...(lyrics.Type === "Syllable" ? { IsPartOfWord: span.IsPartOfWord } : {}),
      }));
      // Classic syllable components use the span envelope, which can differ from
      // a provider's voice envelope. Preserve that exact playback behavior here.
      const start = lyrics.Type === "Static" ? 0 : Math.min(...spans.map(span => span.start!));
      const end = lyrics.Type === "Static" ? 0 : Math.max(...spans.map(span => span.end!));
      return { id: voiceId, role: voiceIndex === 0 ? "lead" as const : "backing" as const, start, end,
        ...(lyrics.Type === "Static" ? {} : { sourceInterval: { start: part.StartTime, end: part.EndTime } }), spans };
    });
    groups.push({ id: groupId, oppositeAligned: row.OppositeAligned === true, voices });
  });
  const hasWordTiming = lyrics.Type === "Syllable" && source?.HasWordSync !== false &&
    groups.some(group => group.voices.some(voice => new Set(voice.spans.map(span => span.start)).size > 1));
  return freeze({ version: 1, id, type: lyrics.Type,
    precision: lyrics.Type === "Static" ? "static" : hasWordTiming ? "word" : "line",
    start: lyrics.Type === "Static" ? 0 : lyrics.StartTime,
    end: lyrics.Type === "Static" ? 0 : lyrics.EndTime,
    groups, source, attribution: structuredClone(lyrics.Attribution),
  });
}

export type LyricCue = Readonly<Interval & { id: string; gapSeconds: number; nextVocalStart: number; internal: boolean }>;
export function HoldsRichSyncGap(cue: LyricCue, limit: number) {
  // Musixmatch offsets are in seconds. Compare at millisecond precision so an
  // exact cutoff is not accidentally admitted by floating-point subtraction.
  return cue.internal && Math.round(cue.gapSeconds * 1000) < limit * 1000;
}
export function CueDisplayStart(start: number, end: number, lastSeconds: number | null) {
  return lastSeconds == null ? start : Math.max(start, end - lastSeconds);
}
export function DeriveCueCandidates(document: LyricDocument, endLead = 0.25): readonly LyricCue[] {
  if (document.type === "Static") return [];
  // Union ALL real voice envelopes, independently of provider order. Candidates
  // are view-independent; eligibility never mutates this document or caches.
  const intervals = document.groups.flatMap(group => group.voices.map(voice => ({ start: voice.start, end: voice.end })))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const cues: LyricCue[] = [];
  let end = 0;
  let internal = false;
  for (const interval of intervals) {
    const gapSeconds = interval.start - end;
    if (gapSeconds > 0) {
      // Keep the Classic .25s lead for ordinary gaps. A small positive gap still
      // gets positive display time instead of a reversed/zero-duration cue.
      cues.push(Object.freeze({ id: `${document.id}/cue${cues.length}`, start: end,
        end: interval.start - Math.min(endLead, gapSeconds / 2), gapSeconds, nextVocalStart: interval.start, internal }));
    }
    end = Math.max(end, interval.end);
    internal = true;
  }
  // Preserve Classic intro/internal gaps, without adding trailing/outro cues.
  return Object.freeze(cues);
}
export function DeriveCues(document: LyricDocument, minimumGap = 2, endLead = 0.25): readonly LyricCue[] {
  if (minimumGap <= 0) return []; // The user-facing zero value explicitly means Off.
  return DeriveCueCandidates(document, endLead).filter(cue => cue.gapSeconds >= minimumGap);
}

// Temporary compatibility projection: the immutable document is the timing/data
// boundary, while the accepted Classic DOM/effect components keep their DTOs.
// Cues exist only in this ephemeral view and never enter transformed caches.
export function ProjectClassic(document: LyricDocument, candidates = DeriveCues(document)): Lyrics {
  // These clones are mutable compatibility DTOs; readonly applies to the owned
  // document, not to detached data handed to legacy components.
  const metadata = { Source: structuredClone(document.source) as Lyrics["Source"], Attribution: structuredClone(document.attribution) as Lyrics["Attribution"] };
  const text = (span: LyricSpan) => ({ Text: span.Text, ...(span.RomanizedText === undefined ? {} : { RomanizedText: span.RomanizedText }) });
  if (document.type === "Static") return { ...metadata, Type: "Static", Lines: document.groups.map(group => text(group.voices[0].spans[0])) };
  const content: any[] = document.groups.map(group => {
    const part = (voice: LyricVoice) => ({ StartTime: voice.sourceInterval!.start, EndTime: voice.sourceInterval!.end,
      Syllables: voice.spans.map(span => ({ ...text(span), StartTime: span.start!, EndTime: span.end!, IsPartOfWord: span.IsPartOfWord! })) });
    const lead = group.voices[0];
    return document.type === "Line"
      ? { Type: "Vocal", OppositeAligned: group.oppositeAligned, ...text(lead.spans[0]), StartTime: lead.start, EndTime: lead.end }
      : { Type: "Vocal", OppositeAligned: group.oppositeAligned, Lead: part(lead), ...(group.voices.length > 1 ? { Background: group.voices.slice(1).map(part) } : {}) };
  });
  // Merge sorted cues once instead of rescanning/splicing the full song per cue.
  // Provider vocal order remains untouched, including unusual unsorted input.
  const cues = candidates;
  const projected: any[] = [];
  let cueIndex = 0;
  const appendCue = (cue: LyricCue) => projected.push({ Type: "Interlude", StartTime: cue.start, EndTime: cue.end });
  content.forEach((row, index) => {
    const start = Math.min(...document.groups[index].voices.map(voice => voice.start));
    while (cueIndex < cues.length && cues[cueIndex].end <= start) appendCue(cues[cueIndex++]);
    projected.push(row);
  });
  while (cueIndex < cues.length) appendCue(cues[cueIndex++]);
  return { ...metadata, Type: document.type, StartTime: document.start, EndTime: document.end, Content: projected };
}
