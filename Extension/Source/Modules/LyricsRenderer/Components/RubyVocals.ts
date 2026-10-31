import type { LyricDocument, LyricVoice } from "../../LyricDocument.ts";
import { BuildVoiceText, CreateDisplayRun, LayoutVoice, SafeLetterAnimation, SourceOwnerKey, type DisplayRun } from "../../TextLayout.ts";
import { LineProjection, ResolveDetail } from "../../RenderProjection.ts";
import { ApplyRenderingAttributes } from "../RenderEffects.ts";
import { LetterEmphasis, type RenderingCounters, type RenderingProfile } from "../../../RenderingSettings.ts";
import SyllableVocals from "./SyllableVocals.ts";
import LineVocals from "./LineVocals.ts";
import StaticVocals from "./StaticVocals.ts";
import { RunAnnotationLayout, type AnnotationLayoutJob } from "../AnnotationLayout.ts";

export type TextChild = SyllableVocals | LineVocals | StaticVocals;
export function CreateTextChild(root: HTMLElement, document: LyricDocument, voice: LyricVoice,
  runs: readonly DisplayRun[], profile: RenderingProfile, counters?: RenderingCounters): TextChild {
  ApplyRenderingAttributes(root, profile);
  const options = { root: root as HTMLDivElement, profile, counters };
  const kind = ResolveDetail(document, profile.detail);
  if (kind === "plain") return new StaticVocals(root, { Text: LineProjection(voice, runs).Text }, false, options);
  if (kind === "line") {
    const line = LineProjection(voice, runs);
    return new LineVocals(root, { Type: "Vocal", Text: line.Text, StartTime: voice.start, EndTime: voice.end,
      OppositeAligned: false }, false, options, line);
  }
  return new SyllableVocals(root, voice.spans.map(span => ({ Text: span.Text, StartTime: span.start!,
    EndTime: span.end!, IsPartOfWord: span.IsPartOfWord! })), voice.role === "backing", false, runs, options);
}
export const IsTimedChild = (child: TextChild): child is SyllableVocals | LineVocals => !(child instanceof StaticVocals);

type ReadingEntry = { metrics?: { width: number; height: number }; pieces?: { range: () => Range; parent: HTMLElement }[]; root: HTMLElement; host: HTMLElement; child: TextChild; start: number; end: number; owner: string; run: DisplayRun };
type ReadingBox = { entry: ReadingEntry; left: number; right: number; top: number; bottom: number; width: number; height: number };
type SourceRow = { top: number; bottom: number; index: number };

// This layer owns readings/layout ONLY. The controller retains its original
// primary renderer, DOM, gradient boxes and springs when ruby arrives or leaves.
// Sibling effect roots prevent primary opacity/filter/motion multiplying readings.
export class RubyVocals {
  readonly Element: HTMLDivElement;
  private entries: ReadingEntry[] = [];
  private fitKey = "";
  private lastTime = 0;
  private mapped = false;
  private lineElement?: HTMLElement;
  private lineSpacer?: HTMLSpanElement;
  private mapping?: ReturnType<RubyVocals['sourceOffsets']>;
  private metricsKey = "";
  private reserved = new Set<HTMLElement>();
  private marginKeys = new Map<HTMLElement, string>();
  private profile: RenderingProfile;
  private readingEmphasis: boolean;
  private click: (event: MouseEvent) => void;
  constructor(private primaryRoot: HTMLElement, private document: LyricDocument, private voice: LyricVoice,
    readings: readonly DisplayRun[], primary: RenderingProfile, annotation: RenderingProfile, private requestSeek: () => void,
    private counters?: RenderingCounters) {
    this.profile = primary;
    this.readingEmphasis = LetterEmphasis(annotation);
    const owner = globalThis.document.createElement("div");
    owner.className = `RubyVocals ${voice.role === "lead" ? "Lead" : "Background"}`;
    primaryRoot.replaceWith(owner); owner.append(primaryRoot); this.Element = owner;
    primaryRoot.classList.add("RubyPrimary");
    this.click = event => { if (!primaryRoot.contains(event.target as Node)) requestSeek(); };
    owner.addEventListener("click", this.click);
    const source = BuildVoiceText(voice), baseRuns = LayoutVoice(voice);
    const line = ResolveDetail(document, primary.detail) === "line" ? LineProjection(voice, baseRuns) : undefined;
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source.text)].map(part => part.index));
    boundaries.add(source.text.length);
    const mapped = readings.flatMap(run => (run.Readings || (run.Reading ? [run.Reading] : [])).map(reading => ({ run, reading })))
      .filter(({ run, reading }) => run.AnnotationDerived && reading.text && boundaries.has(reading.start) && boundaries.has(reading.end) && reading.end > reading.start)
      .sort((a, b) => a.reading.start - b.reading.start);
    let cursor = 0;
    for (const { reading } of mapped) {
      if (reading.start < cursor || reading.end > source.text.length) continue;
      const host = globalThis.document.createElement("span"); host.className = "RubyAnnotation"; host.hidden = true;
      const root = globalThis.document.createElement("span"); root.className = `AnnotationText RubyReading ${voice.role === "lead" ? "Lead" : "Background"}`;
      host.append(root); owner.append(host);
      const ranges = source.ranges.filter(range => range.end > reading.start && range.start < reading.end)
        .map(range => ({ ...range, start: Math.max(reading.start, range.start), end: Math.min(reading.end, range.end) }));
      const owners = baseRuns.filter(owner => owner.SourceRanges.some(range => ranges.some(part => part.spanId === range.spanId)));
      const ownerRanges = owners.flatMap(owner => owner.SourceRanges);
      const run = { ...(line || CreateDisplayRun(reading.text, ownerRanges, false)), Text: reading.text,
        SourceOwners: owners.flatMap(owner => owner.SourceOwners || []), ExplicitSpacing: true, SafeLetters: SafeLetterAnimation(reading.text),
        VisualRange: { start: 0, end: 1 } };
      this.entries.push({ root, host, start: reading.start, end: reading.end,
        owner: line ? "line" : SourceOwnerKey(ownerRanges), run,
        child: CreateTextChild(root, document, voice, [run], annotation, counters) });
      cursor = reading.end;
    }
    this.updateVisualRanges();
  }
  // Multiple anchors inside the same provider owner share one visual sweep.
  // Natural widths are measured only in the bounded layout batch; playback uses
  // these mutable fractions without reading geometry or rebuilding any child.
  private updateVisualRanges() {
    const groups = new Map<string, ReadingEntry[]>();
    for (const entry of this.entries) {
      const group = groups.get(entry.owner) || []; group.push(entry); groups.set(entry.owner, group);
    }
    for (const group of groups.values()) {
      const widths = group.map(entry => entry.metrics?.width || [...entry.run.Text].length || 1);
      const width = widths.reduce((sum, value) => sum + value, 0);
      let offset = 0;
      group.forEach((entry, index) => {
        entry.run.VisualRange!.start = offset / width; offset += widths[index];
        entry.run.VisualRange!.end = offset / width;
      });
    }
  }
  HasReadings() { return this.entries.length > 0; }
  private clearLineLayout(remove = false) {
    this.lineElement?.classList.remove("RubyLineLayout");
    if (remove) {
      this.lineSpacer?.remove(); this.lineSpacer = undefined; this.lineElement = undefined;
    } else if (this.lineSpacer) this.lineSpacer.hidden = true;
  }
  InvalidateLayout(sourceChanged = false) {
    this.fitKey = "";
    if (sourceChanged) {
      this.mapped = false; this.mapping = undefined;
      for(const item of this.reserved)item.style.removeProperty("margin-block-start");
      this.reserved.clear();this.marginKeys.clear();
      this.clearLineLayout(true);
      for (const entry of this.entries) entry.pieces = undefined;
    }
  }
  // Convert exact source offsets to canonical DOM offsets. Word DOM omits the
  // derived separators painted by CSS; line/plain DOM contains those spaces.
  private sourceOffsets() {
    const source = BuildVoiceText(this.voice), runs = LayoutVoice(this.voice);
    if (ResolveDetail(this.document, this.profile.detail) !== "word") {
      const text = LineProjection(this.voice, runs).Text;
      return text === source.text ? { text, offset: (value: number) => value } : undefined;
    }
    let text = "";
    const segments = runs.map(run => { const dom = text.length; text += run.Text; return { dom, start: run.SourceRanges[0].start, end: run.SourceRanges.at(-1)!.end }; });
    return { text, offset: (value: number) => {
      const segment = segments.find(segment => value >= segment.start && value <= segment.end);
      return segment ? segment.dom + value - segment.start : -1;
    } };
  }
  // Feasible intervals preserve reading order, row bounds and overlap with the
  // actual anchor. Free overhang is used first; only real crowding requires fit.
  private place(boxes: ReadingBox[], width: number, factor: number, gap: number, visualScale: number, alignment?: string) {
    const sizes = boxes.map(box => box.width * factor * visualScale);
    const minimum = boxes.map((box, index) => Math.max(0, box.left - sizes[index] + 2));
    const maximum = boxes.map((box, index) => Math.min(width - sizes[index], box.right - 2));
    const earliest: number[] = [];
    for (let index = 0; index < boxes.length; index++) {
      earliest[index] = Math.max(minimum[index], index ? earliest[index - 1] + sizes[index - 1] + gap : 0);
      if (earliest[index] > maximum[index] + .1) return undefined;
    }
    const latest = [...maximum];
    for (let index = boxes.length - 2; index >= 0; index--) latest[index] = Math.min(latest[index], latest[index + 1] - sizes[index] - gap);
    const positions: number[] = [];
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index], desired = alignment === "start" ? box.left : alignment === "end" ? box.right - sizes[index] : (box.left + box.right - sizes[index]) / 2;
      positions[index] = Math.max(earliest[index], Math.min(latest[index], desired), index ? positions[index - 1] + sizes[index - 1] + gap : 0);
    }
    return positions;
  }
  // Cache source node/offset descriptors, never live Range instances: DOM
  // replacement invalidates this map, while width/font changes retain the nodes.
  private mapSource() {
    if (this.mapped) return;
    this.mapped = true; this.mapping = this.sourceOffsets();
    const nodes: { node: Node; start: number; end: number }[] = [];
    const walker = globalThis.document.createTreeWalker(this.primaryRoot, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null, text = "";
    while ((node = walker.nextNode())) {
      const value = node.nodeType === Node.TEXT_NODE ? node.textContent : (node as Element).tagName === "BR" ? "\n" : undefined;
      if (value === undefined) continue;
      const start = text.length; text += value; nodes.push({ node, start, end: text.length });
    }
    if (text !== this.mapping?.text) return;
    for (const entry of this.entries) {
      const start = this.mapping.offset(entry.start), end = this.mapping.offset(entry.end);
      if (start < 0 || end <= start) continue;
      entry.pieces = nodes.filter(part => part.node.nodeType === Node.TEXT_NODE && part.end > start && part.start < end).map(part => ({
        parent: part.node.parentElement!, range: () => {
          const range = globalThis.document.createRange();
          range.setStart(part.node, Math.max(0, start - part.start));
          range.setEnd(part.node, Math.min(part.end, end) - part.start);
          return range;
        }
      }));
    }
  }
  // Renderer effects are axis-only scale/translate. Resolve each effect ancestor
  // once per layout, then invert fractional glyph rectangles into the unchanged
  // source frame. This avoids mounting/layout of a duplicate song on every resize.
  private sourceFrame() {
    type Step = { left: number; top: number; x: number; y: number; layoutLeft: number; layoutTop: number };
    type Rect = { left: number; top: number; right: number; bottom: number };
    const cache = new Map<HTMLElement, Step[]>();
    const apply = (rect: Rect, steps: Step[]) => {
      let { left, top, right, bottom } = rect;
      for (const step of steps) {
        left = (left - step.left) / step.x + step.layoutLeft;
        right = (right - step.left) / step.x + step.layoutLeft;
        top = (top - step.top) / step.y + step.layoutTop;
        bottom = (bottom - step.top) / step.y + step.layoutTop;
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const stepsFor = (node: HTMLElement): Step[] => {
      if (node === this.primaryRoot) return [];
      const existing = cache.get(node);
      if (existing) return existing;
      const steps = [...stepsFor(node.parentElement!)];
      // Word effects are inline spring values; Line also has a CSS scale and
      // transition. Resolve its actual current value, including in-flight seeks.
      if (node.style.scale || node.style.transform || node.style.rotate || node.style.translate || node.classList.contains("Line")) {
        const style = getComputedStyle(node);
        const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
        if (!matrix.is2D || matrix.b || matrix.c || matrix.a <= 0 || matrix.d <= 0 || style.rotate !== "none" || style.translate !== "none") {
          throw Error("unsupported source transform");
        }
        const scales = style.scale === "none" ? [1] : style.scale.split(" ").map(Number);
        const x = scales[0] * matrix.a, y = (scales[1] ?? scales[0]) * matrix.d;
        const origin = style.transformOrigin.split(" ").map(parseFloat);
        const bounds = apply(node.getBoundingClientRect(), steps);
        // First undo the ancestor transforms, then this node's own origin and
        // translation. Fractional rectangles avoid offsetWidth rounding drift.
        steps.push({
          left: bounds.left, top: bounds.top, x, y,
          layoutLeft: bounds.left + origin[0] * (x - 1) - matrix.e * scales[0],
          layoutTop: bounds.top + origin[1] * (y - 1) - matrix.f * (scales[1] ?? scales[0])
        });
      }
      cache.set(node, steps);
      return steps;
    };
    return (rect: Rect, node: HTMLElement) => apply(rect, stepsFor(node));
  }
  FitReadings(fontGeneration = 0, time = this.lastTime) {
    const job = this.PrepareLayout(fontGeneration, time);
    if (job) RunAnnotationLayout([job]);
  }
  PrepareLayout(fontGeneration = 0, time = this.lastTime): AnnotationLayoutJob | undefined {
    this.lastTime = time;
    if (!this.Element.isConnected || !this.entries.length) return;
    const width = this.Element.clientWidth;
    if (!width) return;
    // ResizeObserver can report a real wrapping change within one rounded
    // clientWidth pixel. The neutral owner's fractional width is a layout-only
    // dependency; it is never read by playback/animation.
    const fractionalWidth = this.Element.getBoundingClientRect().width;
    const style = getComputedStyle(this.primaryRoot), ownerStyle = getComputedStyle(this.Element);
    // Natural reading dimensions depend on typography/font completion, not
    // source wrapping. A width-only pass reuses them without reveal/read cycles.
    const metricKey = [fontGeneration, style.font, ownerStyle.getPropertyValue("--annotation-ruby-size"),
      ownerStyle.getPropertyValue("--annotation-spacing"), this.entries[0].root.dataset.jelScale, this.readingEmphasis].join("|");
    const alignment = this.Element.closest<HTMLElement>("[data-annotation-align]")?.dataset.annotationAlign;
    const key = [metricKey, width, fractionalWidth, alignment,
      this.profile.detail, this.profile.emphasis].join("|");
    if (key === this.fitKey) return;
    this.mapSource();
    const freshMetrics = this.entries.some(entry=>entry.pieces?.length) && metricKey !== this.metricsKey;
    let frame=this.sourceFrame();
    const hidden = new Set(this.entries.filter(entry => entry.host.hidden));
    const visualScale = this.entries[0].root.dataset.jelScale === "on" ? 1.1 : 1;
    const gap = Math.max(1, parseFloat(style.fontSize) * .04);
    const isLine = ResolveDetail(this.document, this.profile.detail) !== "word";
    let boxes: ReadingBox[] = [], rows: ReadingBox[][] = [], complete = false, reserveChanged = false;
    const pixels=(style: CSSStyleDeclaration,property: string,value: number)=>{
      const old=parseFloat(style.getPropertyValue(property));
      if(Number.isFinite(old)&&Math.abs(old-value)<.05)return false;
      style.setProperty(property,`${Math.round(value*1000)/1000}px`);return true;
    };
    const factors = new Map<ReadingEntry, number>(), placements = new Map<ReadingEntry, number>();
    const items = [...this.primaryRoot.children] as HTMLElement[];

    const sourceRects=new Map<ReadingEntry,{left:number;right:number;top:number;bottom:number}[]>();
    const line = isLine ? this.primaryRoot.querySelector<HTMLElement>(".Line, .Static") : undefined;
    let sourceRows: SourceRow[] = [], lineHeight = 0, lineContentHeight = 0, lineContentWidth = 0, lineContentTop = 0;
    const makeBoxes = () => {
      boxes=[];
      for(const entry of this.entries){
        const rects=sourceRects.get(entry);if(!rects?.length||!entry.metrics)continue;
        const ordered=[...rects].sort((a,b)=>a.top-b.top),first=ordered.filter(rect=>rect.top<ordered[0].bottom-1);
        const left=Math.min(...first.map(rect=>rect.left)),right=Math.max(...first.map(rect=>rect.right));
        if(right<=0||left>=width)continue;
        boxes.push({entry,left:Math.max(0,left),right:Math.min(width,right),top:Math.min(...first.map(rect=>rect.top)),bottom:Math.max(...first.map(rect=>rect.bottom)),...entry.metrics});
      }
    };
    let unsupportedTransform = false;
    const readBoxes = () => {
      unsupportedTransform=false;
      try {
        const owner=this.Element.getBoundingClientRect();frame=this.sourceFrame();sourceRects.clear();
      for(const entry of this.entries){
        if(!entry.pieces||!entry.metrics)continue;
        const rects=entry.pieces.flatMap(piece=>{
          return [...piece.range().getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(rect=>{
            const rest=frame(rect,piece.parent);return {left:rest.left-owner.left,right:rest.right-owner.left,top:rest.top-owner.top,bottom:rest.bottom-owner.top};
          });
        });sourceRects.set(entry,rects);
      }
      } catch(error) {
        if(!(error instanceof Error)||error.message!=="unsupported source transform")throw error;
        // External rotation/skew is not a renderer effect. Keep the canonical
        // source intact, omit only this unsupported reading layer, and cache
        // that result until a real layout invalidation instead of retry/logging.
        unsupportedTransform=true;sourceRects.clear();
      }
      makeBoxes();
    };
    return {
      prepare: () => {
        this.Element.classList.remove("RubyNoReadings");
        // Measure natural source rows with the previous exclusion removed. All
        // voices cross this write barrier before any source geometry is read.
        // The existing text nodes, gradient owner and springs remain untouched.
        if (isLine) this.clearLineLayout();
        if(freshMetrics)for(const entry of this.entries){
          if(entry.host.hidden)entry.host.hidden=false;
          if(entry.root.style.getPropertyValue("--ruby-fit")!=="1")entry.root.style.setProperty("--ruby-fit","1");
        }
      },
      measure: () => {
        if (freshMetrics) {
          for (const entry of this.entries) entry.metrics = { width: entry.root.scrollWidth, height: entry.root.offsetHeight };
          this.updateVisualRanges();
        }
        readBoxes();
        for (const box of boxes.sort((a,b)=>a.top-b.top||a.left-b.left)) {
          const row = rows.find(row=>Math.abs(row[0].bottom-box.bottom)<2);
          if (row) row.push(box); else rows.push([box]);
        }
        if (line && !unsupportedTransform) {
            const range=globalThis.document.createRange();range.selectNodeContents(line);
            const rects=[...range.getClientRects()].filter(rect=>rect.height>0&&rect.width>0).map(rect=>frame(rect,line));
            const lineStyle=getComputedStyle(line), bounds=frame(line.getBoundingClientRect(),line), owner=this.Element.getBoundingClientRect();
            const value=(property: string)=>parseFloat(lineStyle.getPropertyValue(property))||0;
            lineHeight=parseFloat(lineStyle.lineHeight)||parseFloat(style.fontSize)*1.1818181818;
            lineContentHeight=bounds.height-value("padding-top")-value("padding-bottom")-value("border-top-width")-value("border-bottom-width");
            lineContentWidth=bounds.width-value("padding-left")-value("padding-right")-value("border-left-width")-value("border-right-width");
            lineContentTop=bounds.top-owner.top+value("padding-top")+value("border-top-width");
            // Use the actual line-box step, including zoom/layout-unit rounding.
            // The content height also counts explicit empty BR rows. Mixed-font
            // glyph bounds may differ within one row; they are not extra rows.
            const count=Math.max(1,Math.round(lineContentHeight/lineHeight));
            lineHeight=lineContentHeight/count;
            const byIndex=new Map<number,SourceRow>();
            for(const rect of rects){
              const top=rect.top-owner.top,bottom=rect.bottom-owner.top;
              const index=Math.max(0,Math.round(((top+bottom)/2-lineContentTop-lineHeight/2)/lineHeight));
              const row=byIndex.get(index);
              if(row){row.top=Math.min(row.top,top);row.bottom=Math.max(row.bottom,bottom);}
              else byIndex.set(index,{top,bottom,index});
            }
            sourceRows=[...byIndex.values()].sort((a,b)=>a.index-b.index);
        }
        for (const row of rows) {
          row.sort((a,b)=>a.left-b.left);
          let factor=1, positions=this.place(row,width,1,gap,visualScale,alignment);
          if (!positions) {
            let low=0, high=1;
            for(let pass=0;pass<10;pass++){const middle=(low+high)/2;if(this.place(row,width,middle,gap,visualScale,alignment))low=middle;else high=middle;}
            factor=low*.98; positions=this.place(row,width,factor,gap,visualScale,alignment);
          }
          if (!positions) continue;
          row.forEach((box,index)=>{factors.set(box.entry,factor);placements.set(box.entry,positions![index]);});
        }
      },
      reserve: () => {
        const visible = boxes.filter(box=>factors.has(box.entry));
        if (!visible.length || (isLine && (!line || !sourceRows.length))) {
          // A partial/unsafe Line mapping must never fall through to Word-item
          // margins. Omit this layer until a real layout invalidation instead.
          boxes=[];factors.clear();placements.clear();
          for(const item of this.reserved)item.style.removeProperty("margin-block-start");
          this.reserved.clear();this.marginKeys.clear();
          this.clearLineLayout(true);this.Element.style.removeProperty("padding-top");return;
        }
        const clearance = (box: ReadingBox) => box.height*factors.get(box.entry)!*visualScale+gap+2;
        if (line && sourceRows.length) {
          const wanted=new Map<number,number>();
          for(const box of visible){
            const center=(box.top+box.bottom)/2;
            const row=sourceRows.reduce((best,row)=>Math.abs((row.top+row.bottom)/2-center)<Math.abs((best.top+best.bottom)/2-center)?row:best);
            wanted.set(row.index,Math.max(wanted.get(row.index)||0,clearance(box)));
          }
          const bands:{top:number;bottom:number}[]=[];
          let extra=0,topBand=0;
          sourceRows.forEach((row,index)=>{
            const desired=wanted.get(row.index);if(desired===undefined)return;
            const previous=sourceRows[index-1];
            const free=Math.max(0,row.top-(previous?.bottom??lineContentTop));
            const band=Math.max(0,desired-free);
            if(row.index===0){topBand=band;return;}
            if(!band)return; // An explicit blank row may already provide room.
            const naturalTop=row.index*lineHeight;
            // Shape exclusions touch whole line boxes. Pixel-align their edges
            // and leave a 1px boundary guard so a fractional preceding line does
            // not intersect the NEXT band and skip several rows at once.
            const top=Math.ceil(naturalTop+extra)+1,bottom=top+Math.ceil(band);
            bands.push({top,bottom});extra=bottom-naturalTop;
          });
          reserveChanged=pixels(this.Element.style,"padding-top",topBand)||reserveChanged;
          if(bands.length){
            this.lineElement=line;
            this.lineSpacer??=globalThis.document.createElement("span");
            const spacer=this.lineSpacer;spacer.className="RubyLineSpacer";spacer.setAttribute("aria-hidden","true");
            if(spacer.parentElement!==line)line.prepend(spacer);
            const polygon=["0px 0px"];
            for(const band of bands)polygon.push(`0px ${band.top}px`,`${lineContentWidth}px ${band.top}px`,`${lineContentWidth}px ${band.bottom}px`,`0px ${band.bottom}px`);
            polygon.push(`0px ${lineContentHeight+extra}px`);
            spacer.style.height=`${lineContentHeight+extra}px`;
            spacer.style.shapeOutside=`polygon(${polygon.join(",")})`;
            spacer.hidden=false;line.classList.add("RubyLineLayout");
          } else this.clearLineLayout(true);
          // One empty float excludes only the required interior reading bands.
          // Source text nodes, one canonical paint box and animation ownership
          // survive; no per-row animators or glyph scans are introduced. This
          // always needs the existing post-reserve read, even if padding is equal.
          reserveChanged=true;
        } else {
          // A nowrap source item contributes its own reading clearance to the
          // flex baseline. The browser aligns the rest of that row naturally;
          // unannotated rows pay nothing. em-based clearance follows responsive
          // source fonts without rewriting every item on each width change.
          const desired=new Map<HTMLElement,number>();
          for(const box of visible){
            const first=box.entry.pieces?.[0];if(!first)continue;
            let item=first.parent;while(item.parentElement!==this.primaryRoot&&item.parentElement)item=item.parentElement;
            desired.set(item,Math.max(desired.get(item)||0,factors.get(box.entry)!));
          }
          for(const item of items){
            const factor=desired.get(item);
            const margin=factor===undefined?"":`calc(1em * var(--annotation-ruby-size, .5) * ${factor*visualScale*1.1} + .04em + 2px)`;
            if((this.marginKeys.get(item)||"")!==margin){item.style.marginBlockStart=margin;this.marginKeys.set(item,margin);reserveChanged=true;}
            if(factor!==undefined)this.reserved.add(item);else this.reserved.delete(item);
          }
        }
        for(const entry of this.entries)if(factors.has(entry)){
          const fit=String(factors.get(entry));if(entry.root.style.getPropertyValue("--ruby-fit")!==fit)entry.root.style.setProperty("--ruby-fit",fit);
        }
      },
      locate: () => { if(reserveChanged)readBoxes(); },
      commit: () => {
        const renderable=new Set<ReadingEntry>();
        for(const box of boxes){
          const factor=factors.get(box.entry),position=placements.get(box.entry);
          if(factor===undefined||position===undefined)continue;
          renderable.add(box.entry);
          const x=Math.round((position+box.width*factor*(visualScale-1)/2)*1000)/1000,y=Math.round((box.top-box.height*factor*visualScale-gap)*1000)/1000;
          const translation=`${x}px ${y}px`;if(box.entry.host.style.translate!==translation)box.entry.host.style.translate=translation;
        }
        for(const entry of this.entries){const hide=!renderable.has(entry);if(entry.host.hidden!==hide)entry.host.hidden=hide;}
        this.Element.classList.toggle("RubyNoReadings",!this.entries.some(entry=>!entry.host.hidden));
        this.fitKey=key; this.metricsKey=metricKey; complete=true;
        for (const entry of this.entries) if (!entry.host.hidden && IsTimedChild(entry.child)) {
          if (hidden.has(entry)) entry.child.Animate(time, 0, true);
          else if (freshMetrics) entry.child.Reconcile(time);
        }
      },
      cleanup: () => {
        if(!complete) {
          for(const entry of this.entries){entry.host.hidden=true;entry.host.style.removeProperty("visibility");}
          for(const item of this.reserved)item.style.removeProperty("margin-block-start");
          this.reserved.clear();this.marginKeys.clear();this.clearLineLayout(true);this.Element.style.removeProperty("padding-top");this.Element.classList.add("RubyNoReadings");this.fitKey=key;
        }
      }
    };
  }
  SetRendering(primary: RenderingProfile, annotation: RenderingProfile) {
    if (this.profile.detail !== primary.detail || this.profile.emphasis !== primary.emphasis) {
      this.InvalidateLayout(true);
    }
    // Grapheme spans can change kerning/spacing even at the same font and size.
    // Their effective presence is a natural-metrics dependency, not just paint.
    this.readingEmphasis = LetterEmphasis(annotation);
    this.profile = primary; this.InvalidateLayout();
    for (const entry of this.entries) {
      ApplyRenderingAttributes(entry.root, annotation);
      if (IsTimedChild(entry.child)) entry.child.SetRendering(annotation);
    }
  }
  Animate(time: number, delta: number, immediate?: true) { this.lastTime = time; for (const entry of this.entries) if (!entry.host.hidden && IsTimedChild(entry.child)) entry.child.Animate(time, delta, immediate); }
  NeedsFrame() { return this.entries.some(({ child, host }) => !host.hidden && IsTimedChild(child) && child.NeedsFrame()); }
  RequiresContinuous() { return this.entries.some(({ child, host }) => !host.hidden && IsTimedChild(child) && child.RequiresContinuous()); }
  SetBlur(distance: number, enabled: boolean) { for (const entry of this.entries) entry.root.style.setProperty("--text-blur", enabled ? `${distance}px` : "0px"); }
  Destroy() {
    this.Element.removeEventListener("click", this.click);
    for (const entry of this.entries) entry.child.Destroy();
    this.mapped = false;
    for (const item of this.reserved) item.style.removeProperty("margin-block-start");
    this.clearLineLayout(true);
    this.marginKeys.clear();this.reserved.clear();
    this.entries = []; this.primaryRoot.classList.remove("RubyPrimary");
    this.Element.replaceWith(this.primaryRoot);
  }
}
