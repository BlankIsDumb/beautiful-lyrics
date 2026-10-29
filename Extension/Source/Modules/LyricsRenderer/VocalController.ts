import { Maid } from "@Universal/Modules/Maid.ts";
import { Signal } from "@Universal/Modules/Signal.ts";
import type { LyricDocument, LyricVoice } from "../LyricDocument.ts";
import { LayoutVoice, type DisplayRun } from "../TextLayout.ts";
import { LineProjection, ResolveDetail } from "../RenderProjection.ts";
import { ApplyRenderingAttributes } from "./RenderEffects.ts";
import type { RenderingCounters, RenderingProfile } from "../../RenderingSettings.ts";
import type { SyncedVocals } from "./Types.d.ts";
import SyllableVocals from "./Components/SyllableVocals.ts";
import LineVocals from "./Components/LineVocals.ts";
import StaticVocals from "./Components/StaticVocals.ts";
import { RubyVocals, CreateTextChild, IsTimedChild, type TextChild } from "./Components/RubyVocals.ts";
import { AnnotationRendering, NormalizeAnnotations, type AnnotationProfile } from "../../AnnotationSettings.ts";
import { SourceCaseFor } from "../../RenderingSettings.ts";

// One stable voice identity owns source activity, scrolling and seeking. Detail
// switches replace only its content strategy, leaving root/listeners/signals and
// the renderer's annotation lease intact. Existing Classic effects remain local
// compatibility components; this is not another complete renderer engine.
export class VocalController implements SyncedVocals {
  private maid = new Maid();
  private content = this.maid.Give(new Maid());
  private root: HTMLDivElement;
  private activity = this.maid.Give(new Signal<(active: boolean) => void>());
  private skip = this.maid.Give(new Signal<() => void>());
  ActivityChanged = this.activity.GetEvent();
  RequestedTimeSkip = this.skip.GetEvent();
  private active = false;
  private child!: TextChild | RubyVocals;
  private annotations = NormalizeAnnotations();
  private secondaryRuns?: readonly DisplayRun[];
  private rubyRuns?: readonly DisplayRun[];
  private secondary?: { root: HTMLDivElement; child: TextChild; click: () => void };
  private block?: HTMLDivElement;
  private blurDistance = 0;
  private kind: "plain" | "line" | "word";
  private runs: readonly DisplayRun[];
  private lastTime = 0;
  constructor(parent: HTMLElement, private document: LyricDocument, private voice: LyricVoice,
    private profile: RenderingProfile, private counters?: RenderingCounters, base?: readonly DisplayRun[]) {
    this.root = this.maid.Give(globalThis.document.createElement("div"));
    this.kind = ResolveDetail(document, profile.detail);
    this.runs = base || LayoutVoice(voice);
    const click = () => this.skip.Fire();
    this.root.addEventListener("click", click);
    this.maid.Give(() => this.root.removeEventListener("click", click));
    parent.append(this.root);
    this.createContent();
  }
  private createContent() {
    this.content.CleanUp();
    this.root.replaceChildren();
    this.root.classList.remove("RubyVocals");
    this.root.className = `Vocals ${this.voice.role === "lead" ? "Lead" : "Background"}`;
    ApplyRenderingAttributes(this.root, this.profile);
    const options = { root: this.root, profile: this.profile, counters: this.counters };
    if (this.rubyRuns?.some(run => run.Reading)) {
      this.child = this.content.Give(new RubyVocals(this.root, this.document, this.voice, this.rubyRuns,
        this.profile, this.annotationRendering(), this.counters));
    } else if (this.kind === "plain") {
      this.child = this.content.Give(new StaticVocals(this.root, { Text: LineProjection(this.voice, this.runs).Text }, false, options));
    } else if (this.kind === "line") {
      const line = LineProjection(this.voice, this.runs);
      this.child = this.content.Give(new LineVocals(this.root, { Type: "Vocal", Text: line.Text, StartTime: this.voice.start,
        EndTime: this.voice.end, OppositeAligned: false }, false, options, line));
    } else {
      this.child = this.content.Give(new SyllableVocals(this.root, this.voice.spans.map(span => ({ Text: span.Text,
        StartTime: span.start!, EndTime: span.end!, IsPartOfWord: span.IsPartOfWord! })), this.voice.role === "backing", false, this.runs, options));
    }
    this.root.classList.remove(this.voice.role === "lead" ? "Background" : "Lead");
    this.root.classList.add(this.voice.role === "lead" ? "Lead" : "Background");
  }
  private annotationRendering() { return AnnotationRendering(this.annotations, SourceCaseFor(this.document.precision), this.profile); }
  private clearAnnotationStyle(target: HTMLElement) {
    for (const property of ["--annotation-secondary-size", "--annotation-ruby-size", "--annotation-gap", "--annotation-spacing", "--annotation-opacity"]) target.style.removeProperty(property);
    target.removeAttribute("data-annotation-align");
  }
  private styleAnnotations() {
    const target = this.block || this.root;
    if (!this.secondary && !this.rubyRuns) {
      // Only a real annotated -> Off transition reaches this branch. Initial
      // Original-only rendering returns earlier and performs no annotation writes.
      this.clearAnnotationStyle(target);
      return;
    }
    target.style.setProperty("--annotation-secondary-size", String(this.annotations.secondarySize));
    target.style.setProperty("--annotation-ruby-size", String(this.annotations.rubySize));
    target.style.setProperty("--annotation-gap", `${this.annotations.gap}em`);
    target.style.setProperty("--annotation-spacing", `${this.annotations.spacing}em`);
    target.style.setProperty("--annotation-opacity", String(this.annotations.opacity));
    target.setAttribute("data-annotation-align", this.annotations.alignment);
  }
  private clearSecondary() {
    if (this.secondary) this.secondary.root.removeEventListener("click", this.secondary.click);
    this.secondary?.child.Destroy(); this.secondary?.root.remove(); this.secondary = undefined;
    if (this.block) { this.clearAnnotationStyle(this.block); this.block.replaceWith(this.root); this.block = undefined; }
  }
  private createSecondary() {
    this.clearSecondary();
    if (!this.secondaryRuns?.some(run => run.AnnotationDerived)) return;
    // The combined block is neutral. Primary and secondary each retain their
    // own opacity/filter/effect roots; scrolling measures the complete voice.
    const block = document.createElement("div"); block.className = "VoiceBlock";
    this.root.replaceWith(block); block.append(this.root); this.block = block;
    const root = document.createElement("div"); root.className = `AnnotationText SecondaryText ${this.voice.role === "lead" ? "Lead" : "Background"}`;
    const child = CreateTextChild(root, this.document, this.voice, this.secondaryRuns, this.annotationRendering(), this.counters);
    const click = () => this.skip.Fire();
    root.addEventListener("click", click); block.prepend(root);
    this.secondary = { root, child, click };
  }
  SetAnnotations(settings: AnnotationProfile, secondary?: readonly DisplayRun[], ruby?: readonly DisplayRun[], time = this.lastTime) {
    const secondaryChanged = secondary !== this.secondaryRuns;
    const rubyChanged = ruby !== this.rubyRuns;
    const shapeChanged = secondaryChanged || rubyChanged;
    const previousEffects = this.annotationRendering();
    const previousStyle = JSON.stringify({ ...this.annotations, cases: undefined });
    this.annotations = settings;
    this.secondaryRuns = secondary; this.rubyRuns = ruby;
    // Remember choices while Off without touching primary DOM/animation. A font
    // edit only changes CSS and is measured by the existing group observer.
    if (!shapeChanged && !this.secondary && !this.rubyRuns) return false;
    const effectsChanged = JSON.stringify(previousEffects) !== JSON.stringify(this.annotationRendering());
    if (shapeChanged) { if (rubyChanged) this.createContent(); if (secondaryChanged) this.createSecondary(); }
    else if (effectsChanged) {
      if (this.child instanceof RubyVocals) this.child.SetRendering(this.profile, this.annotationRendering());
      if (this.secondary) {
        ApplyRenderingAttributes(this.secondary.root, this.annotationRendering());
        if (IsTimedChild(this.secondary.child)) this.secondary.child.SetRendering(this.annotationRendering());
      }
    }
    const styleChanged = previousStyle !== JSON.stringify({ ...settings, cases: undefined });
    if (shapeChanged || styleChanged) this.styleAnnotations();
    if (shapeChanged || effectsChanged) { this.SetBlur(this.blurDistance); this.Animate(time, 0, true); }
    return shapeChanged || styleChanged || effectsChanged;
  }
  SetProjection(runs: readonly DisplayRun[], time = this.lastTime) {
    if (runs === this.runs) return;
    this.runs = runs;
    if (this.child instanceof RubyVocals) this.createContent();
    else if (this.child instanceof SyllableVocals) this.child.SetProjection(runs);
    else if (this.child instanceof LineVocals) { const line = LineProjection(this.voice, runs); this.child.SetText(line.Text, line); }
    else this.child.SetText(LineProjection(this.voice, runs).Text);
    this.Animate(time, 0, true); // Local snap, never ForceToActive/manual-scroll reset.
  }
  SetRendering(profile: RenderingProfile, time = this.lastTime) {
    this.profile = profile;
    const kind = ResolveDetail(this.document, profile.detail);
    if (kind !== this.kind) { this.kind = kind; this.createContent(); this.createSecondary(); if (this.secondary || this.rubyRuns) this.styleAnnotations(); }
    else {
      ApplyRenderingAttributes(this.root, profile);
      if (this.child instanceof RubyVocals) this.child.SetRendering(profile, this.annotationRendering());
      else if (!(this.child instanceof StaticVocals)) this.child.SetRendering(profile);
      if (this.secondary) {
        ApplyRenderingAttributes(this.secondary.root, this.annotationRendering());
        if (IsTimedChild(this.secondary.child)) this.secondary.child.SetRendering(this.annotationRendering());
      }
    }
    this.SetBlur(this.blurDistance);
    this.Animate(time, 0, true);
  }
  Animate(time: number, delta: number, immediate?: true) {
    this.lastTime = time;
    if (this.kind === "plain") return;
    const active = time >= this.voice.start && time <= this.voice.end;
    if (this.active !== active) { this.active = active; this.activity.Fire(active); }
    (this.child as SyllableVocals | LineVocals | RubyVocals).Animate(time, delta, immediate);
    if (this.secondary && IsTimedChild(this.secondary.child)) this.secondary.child.Animate(time, delta, immediate);
  }
  IsActive() { return this.active; }
  NeedsFrame() { return (!(this.child instanceof StaticVocals) && this.child.NeedsFrame()) || !!(this.secondary && IsTimedChild(this.secondary.child) && this.secondary.child.NeedsFrame()); }
  RequiresContinuous() { return (!(this.child instanceof StaticVocals) && this.child.RequiresContinuous()) || !!(this.secondary && IsTimedChild(this.secondary.child) && this.secondary.child.RequiresContinuous()); }
  SetBlur(distance: number) {
    this.blurDistance = distance;
    if (this.child instanceof RubyVocals) {
      this.root.style.removeProperty("--text-blur");
      this.child.SetBlur(distance, this.profile.blur, this.annotationRendering().blur);
    }
    else if (this.profile.blur) this.root.style.setProperty("--text-blur", `${distance}px`);
    else this.root.style.removeProperty("--text-blur");
    if (this.secondary) {
      if (this.annotationRendering().blur) this.secondary.root.style.setProperty("--text-blur", `${distance}px`);
      else this.secondary.root.style.removeProperty("--text-blur");
    }
  }
  HasBlur() { return this.profile.blur || (!!(this.secondary || this.rubyRuns) && this.annotationRendering().blur); }
  ClearBlur() {
    this.blurDistance = 0; this.root.style.removeProperty("--text-blur");
    if (this.child instanceof RubyVocals) this.child.SetBlur(0, false, false);
    this.secondary?.root.style.removeProperty("--text-blur");
  }
  HasAnnotations() { return !!this.secondary || this.child instanceof RubyVocals; }
  MeasureAnnotations(fontGeneration = 0) { if (this.child instanceof RubyVocals) this.child.FitReadings(fontGeneration); }
  GetScrollTarget() { return { Element: this.block || this.root, StartTime: this.voice.start }; }
  Destroy() { this.clearSecondary(); this.maid.Destroy(); }
}
