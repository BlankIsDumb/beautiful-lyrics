export type TimelineInterval = Readonly<{ id: string; start: number; end: number }>;
type Boundary = { time: number; id: string };
const upperBound = (events: readonly Boundary[], time: number) => {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
};

// Pure inclusive intervals match Classic's start <= t <= end. Separate sorted
// endpoints let normal frames visit only crossed boundaries and current voices.
// Explicit seeks can sweep once; they never turn into an O(song) frame path.
export class LyricTimeline {
  private readonly intervals: readonly TimelineInterval[];
  private readonly starts: Boundary[];
  private readonly ends: Boundary[];
  private readonly active = new Set<string>();
  private previous: number | undefined;
  private startIndex = 0;
  private endIndex = 0;
  constructor(intervals: readonly TimelineInterval[]) {
    this.intervals = intervals.map(interval => Object.freeze({ ...interval }));
    this.starts = intervals.map(interval => ({ time: interval.start, id: interval.id })).sort((a, b) => a.time - b.time);
    this.ends = intervals.map(interval => ({ time: interval.end, id: interval.id })).sort((a, b) => a.time - b.time);
  }
  isDue(time: number): boolean {
    return this.previous === undefined || time < this.previous ||
      (this.startIndex < this.starts.length && this.starts[this.startIndex].time <= time) ||
      (this.endIndex < this.ends.length && this.ends[this.endIndex].time < time);
  }
  evaluate(time: number, seek = false) {
    const changed = new Set<string>();
    if (seek || this.previous === undefined || time < this.previous) {
      this.active.clear();
      for (const interval of this.intervals) {
        changed.add(interval.id);
        if (interval.start <= time && time <= interval.end) this.active.add(interval.id);
      }
      this.startIndex = upperBound(this.starts, time);
      // Endpoints equal to time remain active for this exact instant.
      this.endIndex = 0;
      let low = 0, high = this.ends.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (this.ends[middle].time < time) low = middle + 1;
        else high = middle;
      }
      this.endIndex = low;
    } else {
      while (this.startIndex < this.starts.length && this.starts[this.startIndex].time <= time) {
        const event = this.starts[this.startIndex++];
        this.active.add(event.id);
        changed.add(event.id);
      }
      while (this.endIndex < this.ends.length && this.ends[this.endIndex].time < time) {
        const event = this.ends[this.endIndex++];
        this.active.delete(event.id);
        changed.add(event.id);
      }
    }
    this.previous = time;
    return { active: new Set(this.active), changed };
  }
}

// Positive delay means lyrics appear later: view time runs behind the transport.
// Do not clamp view time: an instantaneous event at zero must not fire early.
export const LyricTime = (transportTime: number, shared: number, view: number) => transportTime - shared - view;
export const TransportTime = (lyricTime: number, shared: number, view: number, duration: number) =>
  Math.max(0, Math.min(duration, lyricTime + shared + view));
