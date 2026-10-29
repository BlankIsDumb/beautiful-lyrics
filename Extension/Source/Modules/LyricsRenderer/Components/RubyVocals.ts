import type { LyricDocument, LyricVoice } from "../../LyricDocument.ts";
import { BuildVoiceText, CreateDisplayRun, LayoutVoice, type DisplayRun } from "../../TextLayout.ts";
import { LineProjection, ResolveDetail } from "../../RenderProjection.ts";
import { ApplyRenderingAttributes } from "../RenderEffects.ts";
import type { RenderingCounters, RenderingProfile } from "../../../RenderingSettings.ts";
import SyllableVocals from "./SyllableVocals.ts";
import LineVocals from "./LineVocals.ts";
import StaticVocals from "./StaticVocals.ts";

export type TextChild = SyllableVocals | LineVocals | StaticVocals;
export function CreateTextChild(root: HTMLElement, document: LyricDocument, voice: LyricVoice,
  runs: readonly DisplayRun[], profile: RenderingProfile, counters?: RenderingCounters): TextChild {
  ApplyRenderingAttributes(root, profile);
  const options = { root: root as HTMLDivElement, profile, counters };
  const kind = ResolveDetail(document, profile.detail);
  if (kind === "plain") return new StaticVocals(root, { Text: LineProjection(voice, runs).Text }, false, options);
  if (kind === "line") {
    const line = LineProjection(voice, runs);
    return new LineVocals(root, { Type: "Vocal", Text: line.Text, StartTime: voice.start, EndTime: voice.end,
      OppositeAligned: false }, false, options, line);
  }
  return new SyllableVocals(root, voice.spans.map(span => ({ Text: span.Text, StartTime: span.start!,
    EndTime: span.end!, IsPartOfWord: span.IsPartOfWord! })), voice.role === "backing", false, runs, options);
}
export const IsTimedChild = (child: TextChild): child is SyllableVocals | LineVocals => !(child instanceof StaticVocals);

// Ruby's base and reading are sibling effect roots beneath a neutral wrapper.
// Nesting rt in an animated .Vocals root would multiply its opacity/blur/scale
// and make the supposedly independent annotation switches dishonest.
export class RubyVocals {
  private fitKey = "";
  private children: { root: HTMLElement; child: TextChild; reading: boolean }[] = [];
  constructor(private root: HTMLElement, private document: LyricDocument, private voice: LyricVoice,
    readings: readonly DisplayRun[], primary: RenderingProfile, annotation: RenderingProfile, counters?: RenderingCounters) {
    root.classList.remove("Vocals"); root.classList.add("RubyVocals");
    const source = BuildVoiceText(voice);
    const baseRuns = LayoutVoice(voice);
    const line = ResolveDetail(document, primary.detail) === "line" ? LineProjection(voice, baseRuns) : undefined;
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source.text)].map(part => part.index));
    boundaries.add(source.text.length);
    const mapped = readings.flatMap(run => (run.Readings || (run.Reading ? [run.Reading] : [])).map(Reading => ({ ...run, Reading }))).filter(run => run.AnnotationDerived && run.Reading?.text &&
      boundaries.has(run.Reading.start) && boundaries.has(run.Reading.end) && run.Reading.end > run.Reading.start)
      .sort((a, b) => a.Reading!.start - b.Reading!.start);
    const appendBase = (parent: HTMLElement, start: number, end: number) => {
      // Preserve exact source whitespace, including gaps without a timed span.
      // Clipping character ranges never subdivides their original time interval.
      let cursor = start;
      for (const original of baseRuns) {
        const left = Math.max(start, original.SourceRanges[0].start), right = Math.min(end, original.SourceRanges[original.SourceRanges.length - 1].end);
        if (right <= left) continue;
        if (left > cursor) parent.append(source.text.slice(cursor, left));
        const ranges = original.SourceRanges.filter(range => range.end > left && range.start < right)
          .map(range => ({ ...range, start: Math.max(left, range.start), end: Math.min(right, range.end) }));
        const run = line ? { ...line, Text: source.text.slice(left, right) }
          : CreateDisplayRun(source.text.slice(left, right), ranges, false);
        run.ExplicitSpacing = true; run.SafeLetters = false; run.Precision = "grouped";
        const base = globalThis.document.createElement("span"); base.className = `RubyBase ${voice.role === "lead" ? "Lead" : "Background"}`;
        parent.append(base);
        const child = CreateTextChild(base, document, voice, [run], primary, counters);
        this.children.push({ root: base, child, reading: false });
        cursor = right;
      }
      if (cursor < end) parent.append(source.text.slice(cursor, end));
    };
    let cursor = 0;
    for (const run of mapped) {
      const reading = run.Reading!;
      if (reading.start < cursor || reading.end > source.text.length) continue;
      if (cursor < reading.start) appendBase(root, cursor, reading.start);
      const ruby = globalThis.document.createElement("ruby");
      const base = globalThis.document.createElement("rb");
      appendBase(base, reading.start, reading.end); ruby.append(base);
      const rt = globalThis.document.createElement("rt"); rt.className = `AnnotationText RubyReading ${voice.role === "lead" ? "Lead" : "Background"}`;
      ruby.append(rt); root.append(ruby);
      // Line display uses the same complete voice interval union as the base.
      // Word display clips source ranges, never their acoustic intervals.
      const ranges = source.ranges.filter(range => range.end > reading.start && range.start < reading.end)
        .map(range => ({ ...range, start: Math.max(reading.start, range.start), end: Math.min(reading.end, range.end) }));
      const readingRun = { ...(line || CreateDisplayRun(reading.text, ranges, false)), Text: reading.text, ExplicitSpacing: true, SafeLetters: false };
      const child = CreateTextChild(rt, document, voice, [readingRun], annotation, counters);
      this.children.push({ root: rt, child, reading: true });
      cursor = reading.end;
    }
    if (cursor < source.text.length) appendBase(root, cursor, source.text.length);
  }
  // Called only from the scroller's coalesced content/font/viewport layout batch.
  // CSS handles ordinary collisions intrinsically. One indivisible reading wider
  // than the full voice gets a uniform font fit, without changing the saved size.
  FitReadings(fontGeneration = 0) {
    if (!this.root.isConnected) return;
    const width = this.root.clientWidth;
    if (!width) return;
    const style = getComputedStyle(this.root);
    const key = [fontGeneration, width, style.font, style.getPropertyValue("--annotation-ruby-size"), style.getPropertyValue("--annotation-spacing"), globalThis.document.fonts?.status].join("|");
    if (key === this.fitKey) return;
    this.fitKey = key;
    const readings = this.children.filter(entry => entry.reading).map(entry => entry.root);
    // A bounded reset/read/write pair, at most once per layout signature. The
    // resize caused by this write is a no-op on the next coalesced callback.
    for (const reading of readings) reading.style.setProperty("--ruby-fit", "1");
    const fits = readings.map(reading => Math.min(1, Math.max(1, width - 2) / Math.max(1, reading.scrollWidth)));
    readings.forEach((reading, index) => reading.style.setProperty("--ruby-fit", String(fits[index])));
  }
  SetRendering(primary: RenderingProfile, annotation: RenderingProfile) {
    for (const entry of this.children) {
      const profile = entry.reading ? annotation : primary;
      ApplyRenderingAttributes(entry.root, profile);
      if (IsTimedChild(entry.child)) entry.child.SetRendering(profile);
    }
  }
  Animate(time: number, delta: number, immediate?: true) {
    for (const { child } of this.children) if (IsTimedChild(child)) child.Animate(time, delta, immediate);
  }
  NeedsFrame() { return this.children.some(({ child }) => IsTimedChild(child) && child.NeedsFrame()); }
  RequiresContinuous() { return this.children.some(({ child }) => IsTimedChild(child) && child.RequiresContinuous()); }
  SetBlur(distance: number, primary: boolean, annotation: boolean) {
    for (const { root, reading } of this.children) {
      if (reading ? annotation : primary) root.style.setProperty("--text-blur", `${distance}px`);
      else root.style.setProperty("--text-blur", "0px");
    }
  }
  Destroy() {
    for (const { child } of this.children) child.Destroy();
    this.children = []; this.root.replaceChildren(); this.root.classList.remove("RubyVocals");
  }
}
