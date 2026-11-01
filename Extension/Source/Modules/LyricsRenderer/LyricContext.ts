import type { LayoutProfile } from "../../LayoutSettings.ts";

// Indices are document source groups, never visual slots/cues/annotation rows.
export function ContextWindow(length: number, active: readonly number[], before: number | null, after: number | null, fallback = 0): readonly [number, number] {
  if (!length) return [0, -1];
  const first = active.length ? Math.min(...active) : Math.max(0, Math.min(length - 1, fallback));
  const last = active.length ? Math.max(...active) : first;
  return [before === null ? 0 : Math.max(0, first - before), after === null ? length - 1 : Math.min(length - 1, last + after)];
}
export class LyricContext {
  private window: readonly [number, number];
  private span: readonly number[] = [0];
  private ends: number[];
  private endingGroups = new Map<number, number[]>();
  constructor(private length: number, starts: readonly number[], intervals: readonly {index: number; start: number; end: number}[] = starts.map((start,index)=>({index,start,end:start}))) {
    this.window = [0, Math.max(-1, length - 1)];
    for(const interval of intervals){const groups=this.endingGroups.get(interval.end)||[];groups.push(interval.index);this.endingGroups.set(interval.end,groups);}
    this.ends=[...this.endingGroups.keys()].sort((a,b)=>a-b);
  }
  select(active: readonly number[], time: number, seek: boolean, profile: LayoutProfile, browsing: boolean) {
    {
      let preceding: number[]=[];
      if(!active.length) {
        let left=0,right=this.ends.length;
        while(left<right){const mid=(left+right)>>>1;if(this.ends[mid]<time)left=mid+1;else right=mid;}
        // Recreate the last non-silent boundary at the NEW seek time. Latest
        // starts alone lose an earlier voice with a longer backing/lead tail.
        // In silence every voice active at the last ending boundary must end
        // AT that boundary. This precomputed index also preserves zero-duration
        // point groups crossed between frames, without scanning the song.
        if(left)preceding=this.endingGroups.get(this.ends[left-1])!;
      }
      this.span = active.length ? [Math.min(...active), Math.max(...active)] : preceding.length ? [Math.min(...preceding),Math.max(...preceding)] : [0];
    }
    this.window = ContextWindow(this.length, this.span, profile.before, profile.after);
    return !profile.follow || browsing ? [0, this.length - 1] as const : this.window;
  }
}
