import { LyricTimeline, type TimelineInterval } from "../LyricTimeline.ts";
import type { RenderingCounters } from "../../RenderingSettings.ts";

export interface ScheduledVisual {
  Animate(time: number, delta: number, immediate?: true): void;
  NeedsFrame(): boolean;
  RequiresContinuous(): boolean;
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
  constructor(private visuals: ReadonlyMap<string, ScheduledVisual>, intervals: readonly TimelineInterval[],
    private owners: ReadonlyMap<string, string>, private counters?: RenderingCounters) {
    this.timeline = new LyricTimeline(intervals);
  }
  update(time: number, delta: number, immediate?: true) {
    if (this.counters) this.counters.ticks++;
    if (!immediate && time === this.previous && this.settling.size === 0) return;
    immediate = immediate || (this.previous !== undefined && time < this.previous) || undefined;
    this.work.clear();
    if (immediate || this.timeline.isDue(time)) {
      if (this.counters) this.counters.timelineEvaluations++;
      const state = this.timeline.evaluate(time, immediate);
      this.active.clear();
      for (const id of state.active) this.active.add(this.owners.get(id)!);
      for (const id of state.changed) this.work.add(this.owners.get(id)!);
      if (this.counters) this.counters.boundaryUpdates += this.work.size;
    }
    for (const id of this.active) if (this.visuals.get(id)!.RequiresContinuous()) {
      this.work.add(id);
      if (this.counters) this.counters.continuousUpdates++;
    }
    for (const id of this.settling) this.work.add(id);
    for (const id of this.work) {
      const visual = this.visuals.get(id)!;
      visual.Animate(time, delta, immediate);
      if (visual.NeedsFrame()) this.settling.add(id); else this.settling.delete(id);
    }
    this.previous = time;
  }
  // Settings and annotations snap their own content without a global seek or a
  // manual-scroll reset. Retain newly enabled effects until their real sleep state.
  refresh() {
    this.settling.clear();
    for (const [id, visual] of this.visuals) if (visual.NeedsFrame()) this.settling.add(id);
  }
}
