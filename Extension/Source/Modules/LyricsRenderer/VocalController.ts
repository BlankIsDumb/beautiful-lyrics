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
  private presentationVisible = true;
  private child!: TextChild;
  private ruby?: RubyVocals;
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
    private profile: RenderingProfile, private counters?: RenderingCounters, base?: readonly DisplayRun[], private currentTime?: () => number) {
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
    this.root.className = `Vocals ${this.voice.role === "lead" ? "Lead" : "Background"}`;
    ApplyRenderingAttributes(this.root, this.profile);
    const options = { root: this.root, profile: this.profile, counters: this.counters };
    if (this.kind === "plain") {
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
  private createRubyLayer(runs: readonly DisplayRun[]) {
    const layer = new RubyVocals(this.root, this.document, this.voice, runs, this.profile, this.annotationRendering(), () => this.skip.Fire(), this.counters);
    if (layer.HasReadings()) return layer;
    layer.Destroy(); // Invalid ranges add neither reading work nor blank clearance.
    return undefined;
  }
  private annotationRendering() { return AnnotationRendering(this.annotations, SourceCaseFor(this.document.precision), this.profile); }
  private clearAnnotationStyle(target: HTMLElement) {
    for (const property of ["--annotation-secondary-size", "--annotation-ruby-size", "--annotation-gap", "--annotation-spacing", "--annotation-opacity"]) target.style.removeProperty(property);
    target.removeAttribute("data-annotation-align");
  }
  private styleAnnotations() {
    const target = this.block || this.ruby?.Element || this.root;
    if (!this.secondary && !this.ruby) {
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
    if (this.block) { this.clearAnnotationStyle(this.block); this.block.replaceWith(this.ruby?.Element || this.root); this.block = undefined; }
  }
  private createSecondary() {
    this.clearSecondary();
    if (!this.secondaryRuns?.some(run => run.AnnotationDerived)) return;
    // The combined block is neutral. Primary and secondary each retain their
    // own opacity/filter/effect roots; scrolling measures the complete voice.
    const block = document.createElement("div"); block.className = "VoiceBlock";
    const primary = this.ruby?.Element || this.root;
    // The block becomes the single style owner for the combined row/layer.
    // Stale inner custom properties would otherwise override its inherited values.
    this.clearAnnotationStyle(primary);
    primary.replaceWith(block); block.append(primary); this.block = block;
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
    if (shapeChanged) {
      if (rubyChanged) {
        this.ruby?.Destroy(); this.ruby = undefined;
        if (ruby?.some(run => run.Reading || run.Readings?.length)) this.ruby = this.createRubyLayer(ruby);
      }
      if (secondaryChanged) this.createSecondary();
    }
    if (effectsChanged) {
      this.ruby?.SetRendering(this.profile, this.annotationRendering());
      if (this.secondary) {
        ApplyRenderingAttributes(this.secondary.root, this.annotationRendering());
        if (IsTimedChild(this.secondary.child)) this.secondary.child.SetRendering(this.annotationRendering());
      }
    }
    const styleChanged = previousStyle !== JSON.stringify({ ...settings, cases: undefined });
    if (shapeChanged || styleChanged) this.styleAnnotations();
    if (shapeChanged || effectsChanged) {
      // New reading children reconcile to the current clock locally. Touching
      // primary Animate(..., immediate) here would snap its in-flight springs.
      this.SetBlur(this.blurDistance); this.ruby?.Animate(time, 0, true);
      if (this.secondary && IsTimedChild(this.secondary.child)) this.secondary.child.Animate(time, 0, true);
    }
    return shapeChanged || styleChanged || effectsChanged;
  }
  SetProjection(runs: readonly DisplayRun[], time = this.lastTime) {
    if (runs === this.runs) return;
    this.runs = runs;
    if (this.child instanceof SyllableVocals) this.child.SetProjection(runs, time);
    else if (this.child instanceof LineVocals) { const line = LineProjection(this.voice, runs); this.child.SetText(line.Text, line); }
    else this.child.SetText(LineProjection(this.voice, runs).Text);
    this.ruby?.InvalidateLayout(true);
    // Replacement spelling reconciles from the canonical owner's current state.
    // A real seek still reaches Animate(..., immediate) through the scheduler.
    this.Animate(time, 0);
  }
  SetRendering(profile: RenderingProfile, time = this.lastTime) {
    this.profile = profile;
    const kind = ResolveDetail(this.document, profile.detail);
    if (kind !== this.kind) { this.kind = kind; this.createContent(); this.createSecondary();
      if (this.rubyRuns) { this.ruby?.Destroy(); this.ruby = this.createRubyLayer(this.rubyRuns); }
      if (this.secondary || this.rubyRuns) this.styleAnnotations(); }
    else {
      ApplyRenderingAttributes(this.root, profile);
      if (!(this.child instanceof StaticVocals)) this.child.SetRendering(profile);
      this.ruby?.SetRendering(profile, this.annotationRendering());
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
    this.SetLogicalActivity(time >= this.voice.start && time <= this.voice.end);
    (this.child as SyllableVocals | LineVocals).Animate(time, delta, immediate);
    this.ruby?.Animate(time, delta, immediate);
    if (this.secondary && IsTimedChild(this.secondary.child)) this.secondary.child.Animate(time, delta, immediate);
  }
  IsActive() { return this.active; }
  SetLogicalActivity(active: boolean) {
    if (this.active !== active) { this.active = active; this.activity.Fire(active); }
  }
  SetPresentationVisible(visible: boolean) {
    this.presentationVisible = visible;
    if (visible) this.SetBlur(this.blurDistance);
  }
  NeedsFrame() { return (!(this.child instanceof StaticVocals) && this.child.NeedsFrame()) || !!this.ruby?.NeedsFrame() || !!(this.secondary && IsTimedChild(this.secondary.child) && this.secondary.child.NeedsFrame()); }
  RequiresContinuous() { return (!(this.child instanceof StaticVocals) && this.child.RequiresContinuous()) || !!this.ruby?.RequiresContinuous() || !!(this.secondary && IsTimedChild(this.secondary.child) && this.secondary.child.RequiresContinuous()); }
  SetBlur(distance: number) {
    this.blurDistance = distance;
    if (!this.presentationVisible) return;
    if (this.profile.blur) this.root.style.setProperty("--text-blur", `${distance}px`);
    else this.root.style.removeProperty("--text-blur");
    this.ruby?.SetBlur(distance, this.annotationRendering().blur);
    if (this.secondary) {
      if (this.annotationRendering().blur) this.secondary.root.style.setProperty("--text-blur", `${distance}px`);
      else this.secondary.root.style.removeProperty("--text-blur");
    }
  }
  HasBlur() { return this.profile.blur || (!!(this.secondary || this.ruby) && this.annotationRendering().blur); }
  ClearBlur() {
    this.blurDistance = 0; this.root.style.removeProperty("--text-blur");
    this.ruby?.SetBlur(0, false);
    this.secondary?.root.style.removeProperty("--text-blur");
  }
  HasAnnotations() { return !!this.secondary || !!this.ruby; }
  PrepareSourceWrapping() {
    const primary=this.child instanceof SyllableVocals?this.child.PrepareSourceWrapping():undefined;
    const secondary=this.secondary?.child instanceof SyllableVocals?this.secondary.child.PrepareSourceWrapping():undefined;
    return primary||secondary?()=>{primary?.();secondary?.()}:undefined;
  }
  PrepareAnnotations(fontGeneration = 0) { return this.ruby?.PrepareLayout(fontGeneration, this.currentTime?.() ?? this.lastTime); }
  MeasureAnnotations(fontGeneration = 0) { this.ruby?.FitReadings(fontGeneration, this.currentTime?.() ?? this.lastTime); }
  GetScrollTarget() { return { Element: this.block || this.ruby?.Element || this.root, StartTime: this.voice.start }; }
  Destroy() { this.clearSecondary(); this.ruby?.Destroy(); this.ruby = undefined; this.maid.Destroy(); }
}
