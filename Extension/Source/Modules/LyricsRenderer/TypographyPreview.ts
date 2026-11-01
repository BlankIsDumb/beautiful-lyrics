import { ApplyLayoutStyle } from "../../LayoutSettings.ts";
import { PresentationSettings, type PresentationView } from "../../PresentationSettings.ts";
import "../../Stylings/TypographyPreview.scss";

const mounted = new Map<PresentationView, HTMLElement>();
const listeners = new Set<() => void>();
export function RegisterTypography(view: PresentationView, root: HTMLElement) {
  mounted.set(view,root);
  return () => { if(mounted.get(view)===root)mounted.delete(view);for(const listener of listeners)listener(); };
}
export function TypographyMeasured() { for(const listener of listeners)listener(); }

// The modal owns these tiny text probes, their narrow geometry subscription and
// one queued layout task. They never construct a renderer, background or lyrics.
export function CreateTypographyPreview(form: HTMLElement, outputs: ReadonlyMap<PresentationView, {primary: HTMLOutputElement; backing: HTMLOutputElement}>) {
  let disposed=false,frame=0;
  const probes = new Map<PresentationView, {shell: HTMLElement; root: HTMLElement; lead: HTMLElement; backing: HTMLElement}>();
  const geometry = new ResizeObserver(() => queue());
  const observed = new Set<Element>();
  const rem=document.createElement("span");rem.style.cssText="position:fixed;left:-100000px;top:0;width:1rem;height:1rem;visibility:hidden;pointer-events:none";rem.setAttribute("aria-hidden","true");document.body.append(rem);
  const observe = (element: Element) => { if(!observed.has(element)){observed.add(element);geometry.observe(element);} };
  const make = (view: PresentationView) => {
    const shell=document.createElement("div");shell.className="JEL-TypographyPreview";shell.setAttribute("aria-hidden","true");shell.inert=true;
    const page=document.createElement("div");page.className="PreviewSurface";
    const column=document.createElement("div");column.className="PreviewColumn";
    const root=document.createElement("div");root.className="Lyrics";
    const group=document.createElement("div");group.className="VocalsGroup";
    const lead=document.createElement("div"),backing=document.createElement("div");lead.className="Vocals Lead";backing.className="Vocals Background";
    lead.textContent=backing.textContent="M";group.append(lead,backing);root.append(group);column.append(root);page.append(column);shell.append(page);document.body.append(shell);
    const result={shell,root,lead,backing};probes.set(view,result);return result;
  };
  const measure = () => {
    frame=0;if(disposed||!form.isConnected)return;
    for(const [view,output] of outputs) {
      if(output.primary.closest<HTMLFieldSetElement>(".BL-ViewOptions")?.hidden) {
        const probe=probes.get(view);probe?.shell.remove();probes.delete(view);continue;
      }
      const live=mounted.get(view);
      let lead: HTMLElement|null=null,backing:HTMLElement|null=null,kind="";
      if(live?.isConnected && live.getBoundingClientRect().width>0) {
        lead=live.querySelector<HTMLElement>(".Vocals.Lead:not(.AnnotationText)");
        backing=live.querySelector<HTMLElement>(".Vocals.Background:not(.AnnotationText)");kind="mounted";
      }
      if(!lead) {
        const probe=probes.get(view)||make(view);
        const fullscreen=!!document.querySelector(".BeautifulLyricsPage.Fullscreen");
        const host=view==="NowPlaying" ? document.querySelector<HTMLElement>("#BeautifulLyrics-CardView") ?? document.querySelector<HTMLElement>(".main-nowPlayingView-section:has(.main-nowPlayingView-lyricsTitle)") ?? document.querySelector<HTMLElement>(".main-nowPlayingView-section")
          : document.querySelector<HTMLElement>(".Root__main-view") ?? document.querySelector<HTMLElement>(".main-view-container") ?? document.documentElement;
        const width=host?.getBoundingClientRect().width||0,height=host?.getBoundingClientRect().height||0;
        if(host)observe(host);
        if(width<=0||height<=0){output.primary.textContent=output.backing.textContent="Unavailable while column is hidden";continue;}
        kind=view==="NowPlaying"?"Now Playing column":fullscreen?"Fullscreen column":"Lyrics page column";
        probe.shell.className=`JEL-TypographyPreview ${view==="NowPlaying"?"Card":fullscreen?"Fullscreen":"Contained"}`;
        probe.shell.style.width=`${width}px`;probe.shell.style.height=`${height}px`;
        // Same theme inheritance as the represented host, including direct
        // important descendant rules; a saved custom family overrides locally.
        probe.shell.style.fontFamily=getComputedStyle(host!).fontFamily;
        ApplyLayoutStyle(probe.root,PresentationSettings.getLayout(view),PresentationSettings.getFontFamily());
        lead=probe.lead;backing=probe.backing;
      }
      const primary=parseFloat(getComputedStyle(lead).fontSize);
      const secondary=backing?parseFloat(getComputedStyle(backing).fontSize):primary*PresentationSettings.getLayout(view).backingRatio;
      if(primary>0&&secondary>0) {
        const primaryText=`${primary.toFixed(2).replace(/\.?0+$/,"")} CSS px`,backingText=`${secondary.toFixed(2).replace(/\.?0+$/,"")} CSS px`;
        if(output.primary.textContent!==primaryText)output.primary.textContent=primaryText;
        if(output.backing.textContent!==backingText)output.backing.textContent=backingText;
        output.primary.title=output.backing.title=kind;
      }
    }
  };
  const queue = () => { if(!disposed&&!frame)frame=requestAnimationFrame(measure); };
  const unsubscribers=[PresentationSettings.subscribeLayout(queue),PresentationSettings.subscribeFontFamily(queue)];
  listeners.add(queue);window.addEventListener("resize",queue);document.fonts?.addEventListener("loadingdone",queue);
  // Root em/rem changes and relevant host-column resizing are geometry events,
  // not playback work. Observer lifetime ends with this exact modal.
  observe(document.documentElement);observe(rem);queue();
  return () => { disposed=true;if(frame)cancelAnimationFrame(frame);geometry.disconnect();rem.remove();listeners.delete(queue);unsubscribers.forEach(stop=>stop());window.removeEventListener("resize",queue);document.fonts?.removeEventListener("loadingdone",queue);for(const probe of probes.values())probe.shell.remove();probes.clear(); };
}
