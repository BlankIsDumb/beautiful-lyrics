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
  private child!: SyllableVocals | LineVocals | StaticVocals;
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
  SetProjection(runs: readonly DisplayRun[], time = this.lastTime) {
    if (runs === this.runs) return;
    this.runs = runs;
    if (this.child instanceof SyllableVocals) this.child.SetProjection(runs);
    else if (this.child instanceof LineVocals) { const line = LineProjection(this.voice, runs); this.child.SetText(line.Text, line); }
    else this.child.SetText(LineProjection(this.voice, runs).Text);
    this.Animate(time, 0, true); // Local snap, never ForceToActive/manual-scroll reset.
  }
  SetRendering(profile: RenderingProfile, time = this.lastTime) {
    this.profile = profile;
    const kind = ResolveDetail(this.document, profile.detail);
    if (kind !== this.kind) { this.kind = kind; this.createContent(); }
    else {
      ApplyRenderingAttributes(this.root, profile);
      if (!(this.child instanceof StaticVocals)) this.child.SetRendering(profile);
    }
    this.Animate(time, 0, true);
  }
  Animate(time: number, delta: number, immediate?: true) {
    this.lastTime = time;
    if (this.kind === "plain") return;
    const active = time >= this.voice.start && time <= this.voice.end;
    if (this.active !== active) { this.active = active; this.activity.Fire(active); }
    (this.child as SyllableVocals | LineVocals).Animate(time, delta, immediate);
  }
  IsActive() { return this.active; }
  NeedsFrame() { return !(this.child instanceof StaticVocals) && this.child.NeedsFrame(); }
  RequiresContinuous() { return !(this.child instanceof StaticVocals) && this.child.RequiresContinuous(); }
  SetBlur(distance: number) { if (this.profile.blur) this.root.style.setProperty("--text-blur", `${distance}px`); }
  ClearBlur() { this.root.style.removeProperty("--text-blur"); }
  GetScrollTarget() { return { Element: this.root, StartTime: this.voice.start }; }
  Destroy() { this.maid.Destroy(); }
}
