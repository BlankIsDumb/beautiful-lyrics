import { Maid } from "@Universal/Modules/Maid.ts";
import { Signal } from "@Universal/Modules/Signal.ts";
import type { Interlude } from "@Universal/Types/Lyrics.ts";
import type { SyncedVocals } from "../Types.d.ts";

// Same cue eligibility/activity/layout, with no springs, curves, pulse evaluation
// or continuous consumer. The controller owns clicks and the persistent root.
export default class StaticCue implements SyncedVocals {
  private maid = new Maid();
  private active = false;
  private activity = this.maid.Give(new Signal<(active: boolean) => void>());
  private skip = this.maid.Give(new Signal<() => void>());
  ActivityChanged = this.activity.GetEvent();
  RequestedTimeSkip = this.skip.GetEvent();
  constructor(private root: HTMLDivElement, private cue: Interlude) {
    root.classList.add("Interlude", "StaticCue");
    for (let index = 0; index < 3; index++) {
      const dot = this.maid.Give(document.createElement("span"));
      dot.className = "InterludeDot";
      root.append(dot);
    }
  }
  Animate(time: number, _delta = 0, _immediate?: true) {
    const active = time >= this.cue.StartTime && time <= this.cue.EndTime;
    if (active === this.active) return;
    this.active = active;
    if (active) this.root.classList.add("Active"); else this.root.classList.remove("Active");
    this.activity.Fire(active);
  }
  IsActive() { return this.active; }
  NeedsFrame() { return false; }
  SetBlur() {}
  Destroy() { this.maid.Destroy(); }
}
