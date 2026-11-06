import { Maid } from "@Universal/Modules/Maid.ts";
import { Signal } from "@Universal/Modules/Signal.ts";
import type { Interlude } from "@Universal/Types/Lyrics.ts";
import type { RenderingCounters, CueSettings } from "../../RenderingSettings.ts";
import type { SyncedVocals } from "./Types.d.ts";
import { CueDisplayStart } from "../LyricDocument.ts";
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
  private display?: Interlude;
  private active = false;
  constructor(private parent: HTMLElement, private cue: Interlude, private profile: CueSettings, private counters?: RenderingCounters, private gapSeconds = Infinity) {
    parent.append(this.root);
    // Legacy cues expose the shared signal contract but are not seek controls.
    this.display = this.displayFor(profile);
    this.createContent();
  }
  private displayFor(profile: CueSettings): Interlude | undefined {
    if (!(profile.threshold > 0 && this.gapSeconds >= profile.threshold)) return;
    const StartTime = CueDisplayStart(this.cue.StartTime, this.cue.EndTime, profile.lastSeconds);
    return StartTime === this.cue.StartTime ? this.cue : { ...this.cue, StartTime };
  }
  private canAnimate(display: Interlude | undefined, profile: CueSettings) {
    // The inherited .5s fade-in and .075s ending require ordered control points.
    // Respect the exact requested cutoff even if subtraction rounds .575 up.
    return !!display && profile.motion && display.EndTime - display.StartTime > 0.575 && (profile.lastSeconds ?? Infinity) > 0.575;
  }
  private createContent() {
    this.content.CleanUp();
    this.child = undefined;
    this.root.className = "Interlude";
    for (const property of ["transform", "scale", "opacity"]) this.root.style.removeProperty(property);
    const display = this.display;
    this.parent.hidden = !display;
    if (!display) return;
    this.child = this.canAnimate(display, this.profile)
      ? this.content.Give(new InterludeVisual(this.parent, display, { root: this.root, counters: this.counters }))
      : this.content.Give(new StaticCue(this.root, display));
  }
  SetSettings(profile: CueSettings, time: number) {
    const display = this.displayFor(profile);
    const intervalChanged = this.display?.StartTime !== display?.StartTime;
    const motionChanged = this.canAnimate(this.display, this.profile) !== this.canAnimate(display, profile);
    const cutoffChanged = (this.profile.lastSeconds != null) !== (profile.lastSeconds != null);
    this.profile = profile;
    this.display = display;
    if (intervalChanged || (display && motionChanged)) this.createContent();
    if (intervalChanged || (display && (motionChanged || cutoffChanged))) this.Animate(time, 0, true);
    return intervalChanged;
  }
  Animate(time: number, delta: number, immediate?: true) {
    const display = this.display;
    const active = !!display && time >= display.StartTime && time <= display.EndTime;
    if (active !== this.active) { this.active = active; this.activity.Fire(active); }
    // A finite duration is a visible window. Sample the zero-opacity endpoint
    // immediately so spring settling cannot extend it into the early-finish gap.
    const cutoff = display && this.profile.lastSeconds != null && time >= display.EndTime;
    this.child?.Animate(time, delta, cutoff || immediate || undefined);
  }
  GetDisplayInterval() { return this.display; }
  GetScrollTarget() { return {Element: this.parent, StartTime: this.display?.StartTime ?? this.cue.StartTime}; }
  IsActive() { return this.active; }
  NeedsFrame() { return this.child?.NeedsFrame() || false; }
  RequiresContinuous() { return this.child instanceof InterludeVisual; }
  SetBlur() {}
  ClearBlur() {}
  Destroy() { this.maid.Destroy(); }
}
