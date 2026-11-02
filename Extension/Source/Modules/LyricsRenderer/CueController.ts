import { Maid } from "@Universal/Modules/Maid.ts";
import { Signal } from "@Universal/Modules/Signal.ts";
import type { Interlude } from "@Universal/Types/Lyrics.ts";
import type { RenderingCounters, CueSettings } from "../../RenderingSettings.ts";
import type { SyncedVocals } from "./Types.d.ts";
import InterludeVisual from "./Components/Interlude.ts";
import StaticCue from "./Components/StaticCue.ts";

export class CueController implements SyncedVocals {
  private maid = new Maid();
  private content = this.maid.Give(new Maid());
  private root = this.maid.Give(document.createElement("div"));
  private activity = this.maid.Give(new Signal<(active: boolean) => void>());
  private skip = this.maid.Give(new Signal<() => void>());
  ActivityChanged = this.activity.GetEvent();
  RequestedTimeSkip = this.skip.GetEvent();
  private child?: InterludeVisual | StaticCue;
  private eligible = false;
  private active = false;
  constructor(private parent: HTMLElement, private cue: Interlude, private profile: CueSettings, private counters?: RenderingCounters, private gapSeconds = Infinity) {
    parent.append(this.root);
    // Legacy cues expose the shared signal contract but are not seek controls.
    this.reconcile();
  }
  private reconcile() {
    this.eligible = this.profile.threshold > 0 && this.gapSeconds >= this.profile.threshold;
    this.parent.hidden = !this.eligible;
    this.createContent();
  }
  private createContent() {
    this.content.CleanUp();
    this.child = undefined;
    this.root.className = "Interlude";
    for (const property of ["transform", "scale", "opacity"]) this.root.style.removeProperty(property);
    if (!this.eligible) return;
    // The inherited .5s fade-in and .075s ending require ordered control points.
    // Tiny eligible gaps remain real-duration static dots, never stretched timing.
    this.child = this.profile.motion && this.cue.EndTime - this.cue.StartTime > 0.575
      ? this.content.Give(new InterludeVisual(this.parent, this.cue, { root: this.root, counters: this.counters }))
      : this.content.Give(new StaticCue(this.root, this.cue));
  }
  SetSettings(profile: CueSettings, time: number) {
    const eligible = profile.threshold > 0 && this.gapSeconds >= profile.threshold;
    const changed = this.profile.motion !== profile.motion || eligible !== this.eligible;
    this.profile = profile;
    if (changed) this.reconcile();
    this.Animate(time, 0, true);
  }
  Animate(time: number, delta: number, immediate?: true) {
    const active = this.eligible && time >= this.cue.StartTime && time <= this.cue.EndTime;
    if (active !== this.active) { this.active = active; this.activity.Fire(active); }
    this.child?.Animate(time, delta, immediate);
  }
  GetScrollTarget() { return {Element: this.parent, StartTime: this.cue.StartTime}; }
  IsActive() { return this.active; }
  NeedsFrame() { return this.child?.NeedsFrame() || false; }
  RequiresContinuous() { return this.child instanceof InterludeVisual; }
  SetBlur() {}
  ClearBlur() {}
  Destroy() { this.maid.Destroy(); }
}
