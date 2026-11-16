import { ApplyLayoutStyle } from "../../LayoutSettings.ts";
import { PresentationSettings, type PresentationView } from "../../PresentationSettings.ts";
import { GetHorizontalMeasurement, ResolveHorizontalSpacing, type HorizontalSurface } from "../../HorizontalSpacing.ts";
import "../../Stylings/TypographyPreview.scss";

const mounted = new Map<HorizontalSurface, {view: PresentationView; root: HTMLElement}>();
const listeners = new Set<() => void>();
export function RegisterTypography(view: PresentationView, root: HTMLElement, surface: HorizontalSurface = view === "NowPlaying" ? "Card" : root.closest(".Fullscreen") ? "Fullscreen" : "Contained") {
  const entry={view,root};mounted.set(surface,entry);TypographyMeasured();
  return () => { if(mounted.get(surface)===entry)mounted.delete(surface);TypographyMeasured(); };
}
export function TypographyMeasured() { for(const listener of listeners)listener(); }

type FontOutputs = {primary: HTMLOutputElement; backing: HTMLOutputElement};
type Probe = {shell: HTMLElement; root: HTMLElement; lead: HTMLElement; backing: HTMLElement; reservation: HTMLElement};
const surfaceView = (surface: HorizontalSurface): PresentationView => surface === "Card" ? "NowPlaying" : "FullLyrics";
const surfaceTitle = (surface: HorizontalSurface) => ({Card:"Sidecard",Contained:"Ordinary lyrics page",Fullscreen:"Fullscreen/cinema"})[surface];

// One modal owns small text/column probes and a single coalesced geometry queue.
// These probes never construct timed owners, a renderer, or a provider pipeline.
export function CreateTypographyPreview(form: HTMLElement, outputs: ReadonlyMap<PresentationView, FontOutputs>, spacingOutputs: ReadonlyMap<HorizontalSurface, HTMLOutputElement> = new Map()) {
  let disposed=false,frame=0;
  const probes = new Map<HorizontalSurface, Probe>();
  const geometry = new ResizeObserver(() => queue());
  const observed = new Set<Element>();
  const retainedHosts = new Set<Element>();
  const rem=document.createElement("span");rem.style.cssText="position:fixed;left:-100000px;top:0;width:1rem;height:1rem;visibility:hidden;pointer-events:none";rem.setAttribute("aria-hidden","true");document.body.append(rem);
  const observe = (element: Element) => { if(!observed.has(element)){observed.add(element);geometry.observe(element);} };
  const text = (output: HTMLElement, value: string) => { if(output.textContent!==value)output.textContent=value; };
  const unavailable = (output: HTMLOutputElement) => {
    text(output,"Unavailable while the lyrics column is hidden");
    // Exact diagnostics must not outlive the geometry they describe.
    delete output.dataset.left;delete output.dataset.right;delete output.dataset.width;
  };
  const hidden = (output: HTMLElement) => !!output.closest<HTMLFieldSetElement>(".BL-ViewOptions")?.hidden;
  const make = (surface: HorizontalSurface) => {
    const shell=document.createElement("div");shell.className=`JEL-TypographyPreview ${surface}`;shell.setAttribute("aria-hidden","true");shell.inert=true;
    const page=document.createElement("div");page.className="PreviewSurface";
    const column=document.createElement("div");column.className="PreviewColumn";
    const root=document.createElement("div");root.className="Lyrics";
    const group=document.createElement("div");group.className="VocalsGroup";
    const lead=document.createElement("div"),backing=document.createElement("div");lead.className="Vocals Lead";backing.className="Vocals Background";
    const reservation=document.createElement("div");reservation.className="PreviewReservation";
    lead.textContent=backing.textContent="M";group.append(lead,backing);root.append(group);column.append(root,reservation);page.append(column);shell.append(page);document.body.append(shell);
    const result={shell,root,lead,backing,reservation};probes.set(surface,result);return result;
  };
  const usableRoot = (root: HTMLElement) => {
    const scroll=root.closest<HTMLElement>(".LyricsScrollContainer");
    return root.isConnected && root.getBoundingClientRect().width>0 && (!scroll || scroll.clientWidth>0&&scroll.clientHeight>0);
  };
  const liveRoot = (surface: HorizontalSurface) => {
    const root=mounted.get(surface)?.root;
    return root && usableRoot(root) ? root : undefined;
  };
  const preview = (surface: HorizontalSurface) => {
    // A mounted but collapsed scrollport has unavailable live geometry. Do not
    // substitute an optimistic probe merely because its outer card is visible.
    const registered=mounted.get(surface)?.root;
    if(registered?.isConnected&&!usableRoot(registered))return;
    const host=surface==="Card" ? document.querySelector<HTMLElement>("#BeautifulLyrics-CardView") ?? document.querySelector<HTMLElement>(".main-nowPlayingView-section:has(.main-nowPlayingView-lyricsTitle)")
      : surface==="Contained" ? document.querySelector<HTMLElement>(".Root__main-view") ?? document.querySelector<HTMLElement>(".main-view-container") : document.documentElement;
    const rect=host?.getBoundingClientRect();
    const width=surface==="Fullscreen" ? document.documentElement.clientWidth : rect?.width||0;
    const height=surface==="Fullscreen" ? window.innerHeight : rect?.height||0;
    if(host){retainedHosts.add(host);observe(host);}
    if(!host||width<=0||height<=0)return;
    const probe=probes.get(surface)||make(surface);
    const probeWidth=`${width}px`,probeHeight=`${height}px`,family=getComputedStyle(host).fontFamily;
    if(probe.shell.style.width!==probeWidth)probe.shell.style.width=probeWidth;
    if(probe.shell.style.height!==probeHeight)probe.shell.style.height=probeHeight;
    if(probe.shell.style.fontFamily!==family)probe.shell.style.fontFamily=family;
    ApplyLayoutStyle(probe.root,PresentationSettings.getLayout(surfaceView(surface)),PresentationSettings.getFontFamily());
    return probe;
  };
  const measure = () => {
    frame=0;if(disposed||!form.isConnected)return;
    retainedHosts.clear();
    const needed=new Set<HorizontalSurface>();
    for(const [view,output] of outputs) {
      if(hidden(output.primary))continue;
      const live=[...mounted].find(([,entry])=>entry.view===view&&usableRoot(entry.root));
      // Font readouts retain their two presentation profiles. A mounted surface
      // supplies the actual font; an unmounted FullLyrics view uses the page host.
      const surface=live?.[0] ?? (view==="NowPlaying" ? "Card" : document.querySelector(".BeautifulLyricsPage.Fullscreen") ? "Fullscreen" : "Contained");
      const root=live?.[1].root;
      const probe=root?undefined:preview(surface);if(probe)needed.add(surface);
      const lead=root?.querySelector<HTMLElement>(".Vocals.Lead:not(.AnnotationText)")??probe?.lead;
      const backing=root?.querySelector<HTMLElement>(".Vocals.Background:not(.AnnotationText)")??probe?.backing;
      if(!lead){unavailable(output.primary);unavailable(output.backing);continue;}
      const primary=parseFloat(getComputedStyle(lead).fontSize);
      const secondary=backing?parseFloat(getComputedStyle(backing).fontSize):primary*PresentationSettings.getLayout(view).backingRatio;
      if(primary>0&&secondary>0) {
        text(output.primary,`${primary.toFixed(2).replace(/\.?0+$/,"")} px`);
        text(output.backing,`${secondary.toFixed(2).replace(/\.?0+$/,"")} px`);
        output.primary.title=output.backing.title=`${root?"Live":"Preview at this window size"}: ${surfaceTitle(surface)}`;
      }
    }
    for(const [surface,output] of spacingOutputs) {
      if(hidden(output))continue;
      const live=liveRoot(surface);
      if(live) {
        const measurement=GetHorizontalMeasurement(live);
        if(live.dataset.columnAvailable!=="true"||!measurement){unavailable(output);continue;}
        describe(output,surface,"Live",measurement.leftGap,measurement.rightGap,measurement.width,measurement.limited ? "limit" : "");
      } else {
        const probe=preview(surface);if(!probe){unavailable(output);continue;}needed.add(surface);
        const rect=probe.root.getBoundingClientRect(),style=getComputedStyle(probe.root);
        const paddingLeft=parseFloat(style.paddingLeft)||0,paddingRight=parseFloat(style.paddingRight)||0;
        const result=ResolveHorizontalSpacing({rootLeft:0,rootRight:rect.width,defaultLeft:paddingLeft,defaultRight:rect.width-paddingRight,safeLeft:surface==="Fullscreen" ? Math.min(rect.width,probe.reservation.getBoundingClientRect().width):0,safeRight:rect.width,primary:parseFloat(getComputedStyle(probe.lead).fontSize),fontFraction:[...mounted.values()].some(entry=>entry.root.isConnected&&entry.root.querySelector(".AlignedOpposite")) ? .75 : .95,adjustment:PresentationSettings.getEffectiveHorizontalSpacing(surface)});
        if(!result){unavailable(output);continue;}
        describe(output,surface,"Preview at this window size",result.leftGap,result.rightGap,result.width,result.limited ? "limit" : "");
      }
    }
    for(const [surface,probe] of probes)if(!needed.has(surface)){probe.shell.remove();probes.delete(surface);}
    // Route changes can replace a represented host while the modal stays open.
    // Release obsolete nodes rather than retaining every visited page until close.
    for(const element of observed)if(element!==document.documentElement&&element!==rem&&!retainedHosts.has(element)){geometry.unobserve(element);observed.delete(element);}
  };
  const describe=(output:HTMLOutputElement,surface:HorizontalSurface,kind:string,left:number,right:number,width:number,limited:string)=>{
    const value=PresentationSettings.getEffectiveHorizontalSpacing(surface);
    const limit=(Math.abs(value)===100 || limited&&limited!=="false") ? " · at limit" : "";
    text(output,`Width ${Math.round(width)} px · left gap ${Math.round(left)} px · right gap ${Math.round(right)} px${limit}`);
    output.title=`${kind}: ${surfaceTitle(surface)}`;
    // Keep subpixel measurements available for diagnostics and parity tests;
    // rounding the label must not reduce the precision of layout verification.
    for(const [key,number] of [["left",left],["right",right],["width",width]] as const) {
      const exact=String(number);if(output.dataset[key]!==exact)output.dataset[key]=exact;
    }
  };
  const queue = () => { if(!disposed&&!frame)frame=requestAnimationFrame(measure); };
  const unsubscribers=[PresentationSettings.subscribeLayout(queue),PresentationSettings.subscribeFontFamily(queue),PresentationSettings.subscribeHorizontalSpacing(queue)];
  listeners.add(queue);window.addEventListener("resize",queue);document.fonts?.addEventListener("loadingdone",queue);
  // Root em/rem and relevant host-column changes are geometry events, not clock
  // work. The observer, probes and queued callback end with this exact modal.
  observe(document.documentElement);observe(rem);queue();
  return () => { disposed=true;if(frame)cancelAnimationFrame(frame);geometry.disconnect();rem.remove();listeners.delete(queue);unsubscribers.forEach(stop=>stop());window.removeEventListener("resize",queue);document.fonts?.removeEventListener("loadingdone",queue);for(const probe of probes.values())probe.shell.remove();probes.clear(); };
}
