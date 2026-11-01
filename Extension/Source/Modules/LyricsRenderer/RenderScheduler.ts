import { LyricTimeline, type TimelineInterval } from "../LyricTimeline.ts";
import type { RenderingCounters } from "../../RenderingSettings.ts";

export interface ScheduledVisual {
  Animate(time: number, delta: number, immediate?: true): void;
  NeedsFrame(): boolean;
  RequiresContinuous(): boolean;
  SetLogicalActivity?(active: boolean): void;
  SetPresentationVisible?(visible: boolean): void;
}

// Boundary reconciliation may allocate a timeline snapshot. Ordinary ticks only
// reuse these sets and visit active continuous effects / genuinely settling
// components. This is a consumer of the existing clock, not another frame loop.
export class RenderScheduler {
  private timeline: LyricTimeline;
  private active = new Set<string>();
  private settling = new Set<string>();
  private work = new Set<string>();
  private previous?: number;
  private visible?: ReadonlySet<string>;
  private revealed = new Set<string>();
  constructor(private visuals: ReadonlyMap<string, ScheduledVisual>, intervals: readonly TimelineInterval[],
    private owners: ReadonlyMap<string, string>, private counters?: RenderingCounters,
    private activity?: (active: ReadonlySet<string>, time: number, seek: boolean) => void) {
    this.timeline = new LyricTimeline(intervals);
  }
  update(time: number, delta: number, immediate?: true) {
    if (this.counters) this.counters.ticks++;
    if (!immediate && time === this.previous && this.settling.size === 0 && this.revealed.size === 0) return;
    immediate = immediate || (this.previous !== undefined && time < this.previous) || undefined;
    this.work.clear();
    if (immediate || this.timeline.isDue(time)) {
      if (this.counters) this.counters.timelineEvaluations++;
      const state = this.timeline.evaluate(time, immediate);
      const previousActive = new Set(this.active);
      this.active.clear();
      for (const id of state.active) this.active.add(this.owners.get(id)!);
      for (const id of previousActive) if (!this.active.has(id)) this.visuals.get(id)?.SetLogicalActivity?.(false);
      for (const id of this.active) if (!previousActive.has(id)) this.visuals.get(id)?.SetLogicalActivity?.(true);
      // Commit presentation before continuous/settling work. Source activity
      // never depends on a hidden visual's Animate call or DOM classes.
      this.activity?.(this.active, time, !!immediate);
      for (const id of state.changed) this.work.add(this.owners.get(id)!);
      if (this.counters) this.counters.boundaryUpdates += this.work.size;
    }
    for (const id of this.active) if (this.isVisible(id) && this.visuals.get(id)!.RequiresContinuous()) {
      this.work.add(id);
      if (this.counters) this.counters.continuousUpdates++;
    }
    for (const id of this.settling) this.work.add(id);
    for (const id of this.revealed) this.work.add(id);
    for (const id of this.work) {
      if (!this.isVisible(id)) { this.settling.delete(id); continue; }
      const visual = this.visuals.get(id)!;
      visual.Animate(time, delta, immediate || this.revealed.has(id) || undefined);
      if (visual.NeedsFrame()) this.settling.add(id); else this.settling.delete(id);
    }
    this.previous = time;
    this.revealed.clear();
  }
  private isVisible(id: string) { return !this.visible || this.visible.has(id); }
  setVisible(visible: ReadonlySet<string>) {
    for (const [id,visual] of this.visuals) {
      const wasVisible=this.isVisible(id), nowVisible=visible.has(id);
      if(wasVisible===nowVisible)continue;
      visual.SetPresentationVisible?.(nowVisible);
      if(nowVisible)this.revealed.add(id);else{this.revealed.delete(id);this.settling.delete(id);}
    }
    this.visible=visible;
  }
  // Settings and annotations snap their own content without a global seek or a
  // manual-scroll reset. Retain newly enabled effects until their real sleep state.
  refresh() {
    this.settling.clear();
    for (const [id, visual] of this.visuals) if (this.isVisible(id) && visual.NeedsFrame()) this.settling.add(id);
  }
}
