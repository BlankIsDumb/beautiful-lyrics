import {
  Spotify,
  GlobalMaid,
  OnSpotifyReady,
  ShowNotification,
} from "@Spices/Spicetify/Services/Session.ts";
import {
  GetSpicyToken,
  GetBehaviorSettings,
  SaveBehaviorSettings,
  GetRichSyncSettings,
  SaveRichSyncSetting,
  SetSpicyToken,
  Providers,
} from "@Spices/Spicetify/Services/Player/ProviderSettings.ts";
import {
  SongLyrics,
  SongLyricChoices,
  SongChanged,
  SongLyricsLoaded,
  SelectLyricsProvider,
} from "@Spices/Spicetify/Services/Player/mod.ts";
import type { Maid } from "@Universal/Modules/Maid.ts";
import Icons from "./LyricViews/Icons.ts";
import { PresentationSettings, PresentationLanguages, type PresentationView } from "./PresentationSettings.ts";
import type { HorizontalSurface } from "./HorizontalSpacing.ts";
import { TimingSettings, TimingOffsetLimit } from "./TimingSettings.ts";
import { ApplyTextPreset, SourceCases, type RenderingProfile } from "./RenderingSettings.ts";
import { CreateSettingsHelp, BackgroundHelp } from "./SettingsHelp.ts";
import { ClassicBackground, DefaultBackgrounds, type BackgroundProfile } from "./BackgroundSettings.ts";
import { DefaultLayouts, NormalizeFontFamily, type LayoutProfile, type LayoutCategory } from "./LayoutSettings.ts";
import type { ContextAppearance } from "./ContextAppearance.ts";
import { CreateTypographyPreview, TypographyMeasured } from "./Modules/LyricsRenderer/TypographyPreview.ts";
import "./Stylings/ProviderControls.scss";

export function OpenProviderSettings() {
  const content = document.createElement("form");
  content.className = "BL-Settings";
  const lifetime = new AbortController();
  let disposeTypography: (() => void) | undefined;
  const spacingOutputs = new Map<HorizontalSurface, HTMLOutputElement>();
  const spacingControls = new Map<HorizontalSurface, {cancel: () => void; sync: () => void; dispose: () => void}>();
  const sizeOutputs = new Map<PresentationView, {primary: HTMLOutputElement; backing: HTMLOutputElement}>();
  const addHelp = CreateSettingsHelp(content, () => {
    lifetime.abort();
    disposeTypography?.();
    for (const control of spacingControls.values()) control.dispose();
    for (const control of content.querySelectorAll<HTMLInputElement>("input,select,button")) control.disabled = true;
  });
  // No draft-wide Save and no broad observer: every native event has this exact
  // modal lifetime. Guard inherited fieldset disabling as well as late events.
  const listen = (control: HTMLElement, type: string, handler: (event: Event) => void) => {
    control.addEventListener(type, event => {
      if (lifetime.signal.aborted || !content.isConnected || control.matches(":disabled")) return;
      handler(event);
    }, { signal: lifetime.signal });
  };
  content.onsubmit = event => event.preventDefault();
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const apply = (action: () => void, restore?: () => void) => {
    try { action(); status.textContent = "Applied."; return true; }
    catch { restore?.(); status.textContent = "Could not apply settings on this device."; return false; }
  };
  const heading = (parent: HTMLElement, text: string, tag = "h3") => {
    const element = document.createElement(tag); element.textContent = text; parent.append(element); return element;
  };
  const row = (parent: HTMLElement, text: string, control: HTMLElement, help: string, classic: string) => {
    const label = document.createElement("label"); label.textContent = text; label.append(control); parent.append(label);
    return addHelp(label, control, help, classic);
  };
  const toggle = (parent: HTMLElement, text: string, id: string, checked: boolean, help: string, classic: string) => {
    const input = document.createElement("input"); input.type = "checkbox"; input.id = id; input.checked = checked;
    input.setAttribute("role", "switch"); input.setAttribute("aria-label", text);
    row(parent, text, input, help, classic); return input;
  };
  const select = (parent: HTMLElement, text: string, id: string, choices: readonly (readonly [string, string])[], value: string, help: string, classic: string) => {
    const input = document.createElement("select"); input.id = id; input.setAttribute("aria-label", text);
    for (const [value, text] of choices) { const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option); }
    input.value = value; row(parent, text, input, help, classic); return input;
  };
  const checkbox = (input: HTMLInputElement, write: (value: boolean) => void, read: () => boolean, after?: () => void) => {
    listen(input, "change", () => { apply(() => write(input.checked), () => { input.checked = read(); }); after?.(); });
  };
  const numeric = (parent: HTMLElement, text: string, id: string, read: () => number, write: (value: number) => void,
    help: string, classic: string, minimum: number, maximum?: number, step = "0.05", disabled = false) => {
    const input = document.createElement("input"); input.type = "number"; input.id = id; input.required = true;
    input.min = String(minimum); if (maximum !== undefined) input.max = String(maximum);
    input.step = step; input.value = String(read()); input.disabled = disabled;
    input.setAttribute("aria-label", text); row(parent, text, input, help, classic);
    const valid = () => input.value.trim() !== "" && input.validity.valid && Number.isFinite(input.valueAsNumber);
    listen(input, "input", () => {
      if (!valid()) { input.setAttribute("aria-invalid", "true"); status.textContent = "Enter a valid number; the previous value is still active."; return; }
      input.removeAttribute("aria-invalid"); apply(() => write(input.valueAsNumber), () => { input.value = String(read()); });
    });
    listen(input, "blur", () => {
      if (valid()) return;
      input.value = String(read()); input.removeAttribute("aria-invalid");
      status.textContent = "Invalid number discarded; the previous value is still active.";
    });
    return input;
  };
  const animationControls = (parent: HTMLElement, prefix: string, scope: string, read: () => RenderingProfile,
    write: (value: RenderingProfile) => void, after?: () => void) => {
    const easing = select(parent, "Easing", prefix + "AnimationEasing", [["classic", "Classic"], ["linear", "Linear"],
      ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in/out"]], read().animationEasing,
      `${scope}. Shapes enabled scale, vertical motion and glow between their existing keyframes. Linear with Direct follows the keyframes without spring lag or extra easing.`, "Classic");
    const response = select(parent, "Response", prefix + "AnimationResponse", [["classic", "Classic"], ["slow", "Slow"],
      ["fast", "Fast"], ["direct", "Direct"]], read().animationResponse,
      `${scope}. Slow and Fast change how quickly enabled effects react. Direct applies the current effect immediately without spring lag or bounce. Lyric timing and highlighting keep their own progress.`, "Classic");
    easing.setAttribute("aria-label", `${scope} easing`);
    response.setAttribute("aria-label", `${scope} response`);
    const sync = () => {
      const profile = read();
      easing.value = profile.animationEasing;
      response.value = profile.animationResponse;
    };
    for (const [key, control] of [["animationEasing", easing], ["animationResponse", response]] as const) {
      listen(control, "change", () => {
        apply(() => write({ ...read(), [key]: control.value as RenderingProfile[typeof key], preset: "custom" }), sync);
        after?.();
      });
    }
    return sync;
  };
  const behaviorSection = document.createElement("section"); content.append(behaviorSection); heading(behaviorSection, "Behavior");
  const fetchMode = select(behaviorSection, "Fetch lyrics", "BL-FetchMode", [["change", "On song change"], ["required", "When required"]], GetBehaviorSettings().fetchMode,
    "When required loads on the lyrics page. An enabled sidebar also loads on song change.", "On song change");
  listen(fetchMode, "change", () => apply(() => SaveBehaviorSettings({ ...GetBehaviorSettings(), fetchMode: fetchMode.value as "change" | "required" }), () => { fetchMode.value = GetBehaviorSettings().fetchMode; }));
  const timingReadOnly = TimingSettings.isReadOnly(), presentationReadOnly = PresentationSettings.isReadOnly();
  const addTiming = (scope: "Shared" | PresentationView, parent: HTMLElement) => numeric(parent,
    scope === "Shared" ? "Lyric delay (s)" : "Delay offset (s)", `JEL-${scope}-TimingOffset`, () => TimingSettings.get(scope),
    value => TimingSettings.save({ Shared: TimingSettings.get("Shared"), NowPlaying: TimingSettings.get("NowPlaying"), FullLyrics: TimingSettings.get("FullLyrics"), [scope]: value }),
    scope === "Shared" ? "Both views. Positive = later; negative = earlier. View offsets add to this delay." : "This view only, added to the shared delay. Positive = later; negative = earlier.", "0 s", -TimingOffsetLimit, TimingOffsetLimit, "0.05", timingReadOnly);
  const shared = addTiming("Shared", behaviorSection); shared.setAttribute("aria-label", "Shared lyric delay in seconds");
  if (timingReadOnly) heading(behaviorSection, "Timing settings require a newer version.", "p");
  heading(behaviorSection, "Enabled providers", "h4");
  for (const name of Providers) {
    const input = toggle(behaviorSection, name, "BL-Provider-" + name, GetBehaviorSettings().providers[name], "Available lyric source. Changes reload the current source choices.", "On");
    checkbox(input, value => { const current = GetBehaviorSettings(); SaveBehaviorSettings({ ...current, providers: { ...current.providers, [name]: value } }); }, () => GetBehaviorSettings().providers[name]);
  }
  heading(behaviorSection, "Rich sync compensation", "h4");
  numeric(behaviorSection, "Hold highlight across gaps (s)", "BL-RichSyncHoldSeconds",
    () => GetRichSyncSettings().holdSeconds, value => SaveRichSyncSetting("holdSeconds", value),
    "Musixmatch only. Holds the completed line’s highlight across shorter gaps. Gaps at or above the limit use normal dimming and dots. Set to 0 to disable.",
    "", 0, undefined, "any");
  numeric(behaviorSection, "Minimum timed segments per line", "BL-RichSyncMinimumSegments",
    () => GetRichSyncSettings().minimumSegmentsPerLine, value => SaveRichSyncSetting("minimumSegmentsPerLine", value),
    "Musixmatch only. Uses Line sync when the average number of distinct timed starts per lyric line falls below this value. Set to 0 to disable.",
    "", 0, undefined, "any");
  const lyricsSection = document.createElement("section"); content.append(lyricsSection); heading(lyricsSection, "Lyrics");
  const family=document.createElement("input");family.id="JEL-FontFamily";family.type="text";family.value=PresentationSettings.getFontFamily();family.placeholder="Spotify / theme font";family.disabled=presentationReadOnly;
  row(lyricsSection,"Lyric font family",family,"One local CSS font-family list for both viewers, including readings. Empty follows Spotify and your theme (including Comfy). No font downloads; a family must already be available.","Spotify / theme font");
  listen(family,"change",()=>{
    const next=NormalizeFontFamily(family.value);
    if(next!==family.value.trim()||(next&&!CSS.supports("font-family",next))){family.setAttribute("aria-invalid","true");status.textContent="Enter a valid local font-family list; the previous font is still active.";return;}
    family.removeAttribute("aria-invalid");apply(()=>PresentationSettings.saveFontFamily(next),()=>{family.value=PresentationSettings.getFontFamily()});
  });
  for (const view of ["NowPlaying", "FullLyrics"] as const) {
    const viewTitle = view === "NowPlaying" ? "Now Playing" : "Full Lyrics";
    const section = document.createElement("section"); section.className = "BL-ViewSettings"; lyricsSection.append(section);
    const title = heading(section, viewTitle, "h4"); title.id = `JEL-${view}-Heading`; section.setAttribute("aria-labelledby", title.id);
    let sidebar: HTMLInputElement | undefined;
    if (view === "NowPlaying") sidebar = toggle(section, "Enabled", "BL-SidebarEnabled", GetBehaviorSettings().sidebarEnabled, "Show lyrics in Now Playing. Off keeps your settings and collapses all options below.", "On");
    const fields = document.createElement("fieldset"); fields.className = "BL-ViewOptions"; fields.id = `JEL-${view}-Options`; section.append(fields);
    if (sidebar) {
      sidebar.setAttribute("aria-label", "Now Playing enabled"); sidebar.setAttribute("aria-controls", fields.id);
      const expansion = () => { fields.hidden = !sidebar!.checked; fields.disabled = !sidebar!.checked; sidebar!.setAttribute("aria-expanded", String(sidebar!.checked)); TypographyMeasured(); };
      checkbox(sidebar, value => SaveBehaviorSettings({ ...GetBehaviorSettings(), sidebarEnabled: value }), () => GetBehaviorSettings().sidebarEnabled, expansion); expansion();
    }
    const delay = addTiming(view, fields); delay.setAttribute("aria-label", `${viewTitle} delay offset in seconds`);
    if (view === "FullLyrics") delay.setAttribute("aria-description", "Fullscreen, cinema and lyrics page share this viewer.");
    const backgroundGroup = document.createElement("details"), backgroundSummary = document.createElement("summary"), backgroundFields = document.createElement("fieldset");
    backgroundGroup.className = "BL-CaseSettings"; backgroundSummary.textContent = "Background";
    backgroundFields.className = "BL-GroupOptions"; backgroundFields.disabled = presentationReadOnly;
    backgroundGroup.append(backgroundSummary, backgroundFields); fields.append(backgroundGroup);
    const backgroundRead = () => PresentationSettings.getBackground(view);
    const backgroundWrite = <K extends keyof BackgroundProfile>(key: K, value: BackgroundProfile[K]) =>
      PresentationSettings.saveBackground(view, { ...backgroundRead(), [key]: value });
    const backgroundInputs = new Map<keyof BackgroundProfile, HTMLInputElement | HTMLSelectElement>();
    const syncBackground = () => {
      const value = backgroundRead();
      for (const [key, input] of backgroundInputs) {
        input.value = String(value[key]); input.removeAttribute("aria-invalid");
        input.disabled = presentationReadOnly || (key !== "mode" && value.mode === "off") ||
          (value.mode === "static" && ["motion", "paused", "fps"].includes(key));
      }
    };
    const backgroundSelect = <K extends Exclude<keyof BackgroundProfile, "brightness">>(key: K, label: string, choices: readonly (readonly [string, string])[], classic: string) => {
      const input = select(backgroundFields, label, `JEL-${view}-Background-${key}`, choices, backgroundRead()[key], BackgroundHelp[key], classic);
      backgroundInputs.set(key, input);
      listen(input, "change", () => { apply(() => backgroundWrite(key, input.value as BackgroundProfile[K])); syncBackground(); });
    };
    backgroundSelect("mode", "Mode", [["animated", "Animated"], ["static", "Static"], ["off", "Off"]], "Animated");
    backgroundSelect("motion", "Motion speed", [["slow", "Slow (0.5×)"], ["classic", "Classic (1×)"], ["fast", "Fast (2×)"]], "1×");
    backgroundInputs.set("brightness", numeric(backgroundFields, "Brightness (%)", `JEL-${view}-Background-brightness`,
      () => backgroundRead().brightness, value => backgroundWrite("brightness", value), BackgroundHelp.brightness, "100%", 50, 150, "5"));
    backgroundSelect("paused", "When paused", [["freeze", "Freeze"], ["animate", "Animate"]], "Animate");
    backgroundSelect("fps", "Frame rate", [["uncapped", "Uncapped"], ["60", "60 fps"], ["30", "30 fps"], ["15", "15 fps"]], "Preserves quality choice");
    backgroundSelect("resolution", "Resolution", [["full", "Full"], ["half", "Half"], ["quarter", "Quarter"]], "Preserves quality choice");
    for (const classic of [true, false]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = classic ? "Classic background" : "Reset background";
      backgroundFields.append(button);
      listen(button, "click", () => {
        apply(() => PresentationSettings.saveBackground(view, classic ? ClassicBackground(backgroundRead()) : { ...DefaultBackgrounds[view] }));
        syncBackground();
      });
    }
    syncBackground();
    const defaults=DefaultLayouts[view];
    const layoutRead=()=>PresentationSettings.getLayout(view);
    const layoutWrite=<K extends keyof LayoutProfile>(key: K,value: LayoutProfile[K])=>PresentationSettings.saveLayout(view,{...layoutRead(),[key]:value});
    const layoutInputs=new Map<keyof LayoutProfile, HTMLInputElement|HTMLSelectElement>();
    // Reset handlers are registered before the Context controls are created.
    // The callback is assigned below and runs only for later user actions.
    let syncContextAppearance = () => {};
    const layoutSection=(title: string,category: LayoutCategory)=>{
      const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("fieldset");
      details.className="BL-CaseSettings";summary.textContent=title;body.className="BL-GroupOptions";body.disabled=presentationReadOnly;
      details.append(summary,body);fields.append(details);
      const reset=document.createElement("button");reset.type="button";reset.textContent=category==="scrolling"?`Reset scrolling (${defaults.anchor}% anchor)`:category==="context"?"Reset context":`Classic ${title.toLowerCase()}`;body.append(reset);
      listen(reset,"click",()=>{if(category==="typography")for(const surface of (view==="NowPlaying"?["Card"]:["Contained","Fullscreen"]) as HorizontalSurface[])spacingControls.get(surface)?.cancel();apply(()=>PresentationSettings.resetLayout(view,category));for(const control of spacingControls.values())control.sync();for(const [key,input] of layoutInputs){const value=layoutRead()[key];if(input instanceof HTMLInputElement&&input.type==="checkbox")input.checked=value as boolean;else input.value=value===null?"":String(value)}if(category==="context")syncContextAppearance();});
      return body;
    };
    const layoutNumber=(parent: HTMLElement,key: keyof LayoutProfile,label: string,min: number,max: number,step: string,help: string,classic: string)=>{
      const input=numeric(parent,label,`JEL-${view}-Layout-${key}`,()=>layoutRead()[key] as number,value=>layoutWrite(key,value),help,classic,min,max,step,presentationReadOnly);layoutInputs.set(key,input);return input;
    };
    const nullable=(parent:HTMLElement,key:"groupGap"|"before"|"after",label:string,min:number,max:number,step:string,empty:string,help:string,classic:string)=>{
      const input=document.createElement("input");input.type="number";input.id=`JEL-${view}-Layout-${key}`;input.min=String(min);input.max=String(max);input.step=step;input.placeholder=empty;input.value=layoutRead()[key]===null?"":String(layoutRead()[key]);input.setAttribute("aria-label",label);
      row(parent,label,input,help,classic);layoutInputs.set(key,input);
      listen(input,"input",()=>{
        if(input.value===""&&!input.validity.badInput){input.removeAttribute("aria-invalid");apply(()=>layoutWrite(key,null));return;}
        if(!input.validity.valid||!Number.isFinite(input.valueAsNumber)){input.setAttribute("aria-invalid","true");status.textContent="Enter a valid number; the previous value is still active.";return;}
        input.removeAttribute("aria-invalid");apply(()=>layoutWrite(key,input.valueAsNumber));
      });
      listen(input,"blur",()=>{if(input.getAttribute("aria-invalid")){const value=layoutRead()[key];input.value=value===null?"":String(value);input.removeAttribute("aria-invalid")}});return input;
    };
    const typography=layoutSection("Typography","typography");
    const primary=layoutNumber(typography,"primaryRatio","Primary size (×)",.5,2,"0.05","Multiplier .5–2 over this viewer's complete responsive default, after its clamp resolves. Word and Line share this layout; CSS px below resolve at the current column size.","1×");
    const primaryOutput=document.createElement("output");primaryOutput.htmlFor=primary.id;primaryOutput.setAttribute("aria-label",`${viewTitle} resolved primary CSS pixels`);primary.closest(".BL-HelpRow")!.append(primaryOutput);
    const backing=layoutNumber(typography,"backingRatio","Backing size (× primary)",.5,1,"0.05","Backing voices use .5–1 of the resolved primary size. Independent of primary scaling and reading size.",".75×");
    const backingOutput=document.createElement("output");backingOutput.htmlFor=backing.id;backingOutput.setAttribute("aria-label",`${viewTitle} resolved backing CSS pixels`);backing.closest(".BL-HelpRow")!.append(backingOutput);sizeOutputs.set(view,{primary:primaryOutput,backing:backingOutput});
    layoutNumber(typography,"leadWeight","Lead weight",100,900,"100","CSS weight 100–900, in 100 steps. The selected font must support the weight; the browser may synthesize or choose the nearest face.","700");
    layoutNumber(typography,"backingWeight","Backing weight",100,900,"100","Independent CSS backing weight, 100–900. Actual appearance depends on the available font faces.","500");
    layoutNumber(typography,"leading","Source line height",1,2.5,"any","Ratio 1–2.5 of the source font size between wrapped source rows. Does not change the independent reading row gap.","1.1818181818");
    nullable(typography,"groupGap","Between groups (em)",0,2,"0.05","Classic","Total gap 0–2 primary-source em between logical source groups. Reading rows and wrapped rows do not become groups. Empty preserves the responsive Classic margins.","Responsive 1cqw on each side");
    for (const [surface, surfaceTitle] of (view === "NowPlaying" ? [["Card", "Sidecard"]] : [["Contained", "Ordinary lyrics page"], ["Fullscreen", "Fullscreen/cinema"]]) as [HorizontalSurface, string][]) {
      const lease = PresentationSettings.createHorizontalPreview(surface);
      const range = document.createElement("input"), number = document.createElement("input");
      range.type = "range"; number.type = "number";
      range.id = `JEL-${surface}-HorizontalSpacing`; number.id = `${range.id}-Number`;
      for (const input of [range, number]) { input.min="-100";input.max="100";input.step="1";input.disabled=presentationReadOnly; }
      number.required=true;
      range.setAttribute("aria-label", `${surfaceTitle} horizontal spacing`);
      number.setAttribute("aria-label", `${surfaceTitle} horizontal spacing adjustment`);
      const help = `${surfaceTitle} only. Signed adjustment −100–100: −100 uses the widest allowed column, 0 preserves the surface default, +100 narrows toward four primary-font em where possible. Source font size stays unchanged. ${surface==="Fullscreen" ? "The left gap includes the protected artwork/control reservation." : surface==="Card" ? "The sidecard's inner padding is protected; negative values may already be at the outward limit." : "The widest column reaches this lyrics viewport's edges."} Readouts describe column edges in CSS pixels, not glyph ink.`;
      row(typography,`${surfaceTitle} horizontal spacing`,range,help,"0 (surface default)");
      // The help helper owns one accessible row. Both editing controls share it;
      // synchronization assigns values directly, never synthetic input events.
      const container=range.closest<HTMLElement>(".BL-HelpRow")!;container.classList.add("BL-HorizontalSpacing");number.setAttribute("aria-describedby",range.getAttribute("aria-describedby")!);container.append(number);
      const output=document.createElement("output");output.htmlFor=`${range.id} ${number.id}`;output.setAttribute("aria-label",`${surfaceTitle} resolved horizontal column CSS pixels`);container.append(output);spacingOutputs.set(surface,output);
      const reset=document.createElement("button");reset.type="button";reset.textContent=`Reset ${surfaceTitle.toLowerCase()} spacing`;reset.disabled=presentationReadOnly;container.append(reset);
      const sync=()=>{const value=PresentationSettings.getEffectiveHorizontalSpacing(surface);range.value=number.value=String(value);number.removeAttribute("aria-invalid");};
      const valid=()=>number.value.trim()!==""&&number.validity.valid&&Number.isInteger(number.valueAsNumber);
      const cancel=()=>{lease.cancel();sync();};
      const commit=(value:number)=>{apply(()=>lease.commit(value),cancel);sync();};
      listen(range,"input",()=>{const value=Number(range.value);number.value=range.value;number.removeAttribute("aria-invalid");lease.set(value);});
      listen(range,"change",()=>commit(Number(range.value)));
      listen(number,"input",()=>{
        if(!valid()){number.setAttribute("aria-invalid","true");status.textContent="Enter a whole number from −100 to 100; the previous value is still active.";return;}
        number.removeAttribute("aria-invalid");range.value=number.value;lease.set(number.valueAsNumber);
      });
      listen(number,"change",()=>{if(valid())commit(number.valueAsNumber);});
      listen(number,"blur",()=>{if(!valid()){cancel();status.textContent="Invalid number discarded; the saved spacing is still active.";}});
      for(const input of [range,number])listen(input,"keydown",event=>{if((event as KeyboardEvent).key==="Escape"){event.preventDefault();event.stopPropagation();cancel();status.textContent="Spacing preview cancelled.";}});
      listen(reset,"click",()=>{cancel();apply(()=>PresentationSettings.saveHorizontalSpacing(surface,0),sync);sync();});
      spacingControls.set(surface,{cancel,sync,dispose:()=>lease.dispose()});sync();
    }
    const contextFields=layoutSection("Context","context");
    nullable(contextFields,"before","Groups before",0,Number.MAX_SAFE_INTEGER,"1","All","Nonnegative whole source-group count before the earliest active group. Empty = All. Concurrent activity and all intervening source groups form one block; cues/readings/wrapped rows do not count.",String(defaults.before ?? "All"));
    nullable(contextFields,"after","Groups after",0,Number.MAX_SAFE_INTEGER,"1","All","Nonnegative whole groups after the latest active group. Empty = All. Manual browsing and Auto-follow Off reveal All while remembering these counts. Untimed text always shows All.","All");
    heading(contextFields,"Outside context","h5");
    const appearanceRead = () => PresentationSettings.getContextAppearance(view);
    const appearanceWrite = <K extends keyof ContextAppearance>(key: K, value: ContextAppearance[K]) =>
      PresentationSettings.saveContextAppearance(view, { ...appearanceRead(), [key]: value });
    const appearanceMode = select(contextFields,"Outside context",`JEL-${view}-Context-mode`,[["hide","Hide"],["muted","Show muted lyrics"]],appearanceRead().mode,
      "Hide stops outside-context visual effects and hides those groups. Show muted lyrics keeps them static and clickable; hover/focus lightens only that group without restarting animation. Both counts All, Auto-follow Off and manual browsing show the full song without this treatment, while remembering these choices.","Hide");
    const appearanceFields = document.createElement("fieldset"); appearanceFields.className="BL-ContextAppearance";contextFields.append(appearanceFields);
    const blurEnabled = toggle(appearanceFields,"Blur",`JEL-${view}-Context-blurEnabled`,appearanceRead().blurEnabled,
      "Independently blur outside-context source text and readings. Disable to preserve the remembered amount without applying a filter.","On");
    const blur = numeric(appearanceFields,"Blur amount (CSS px)",`JEL-${view}-Context-blur`,()=>appearanceRead().blur,value=>appearanceWrite("blur",value),
      "Blur radius in CSS pixels, 0–12 in 0.25 steps. Zero is neutral; it does not change lyric layout.","2 CSS px",0,12,"0.25");
    const darkeningEnabled = toggle(appearanceFields,"Darkening",`JEL-${view}-Context-darkeningEnabled`,appearanceRead().darkeningEnabled,
      "Independently darken outside-context source text and readings toward black, without changing the background or transparency.","On");
    const darkening = numeric(appearanceFields,"Darkening (%)",`JEL-${view}-Context-darkening`,()=>appearanceRead().darkening,value=>appearanceWrite("darkening",value),
      "Brightness reduction toward black: 0% is neutral and 100% is black. This is independent of opacity.","60%",0,100,"1");
    const opacity = numeric(appearanceFields,"Opacity (%)",`JEL-${view}-Context-opacity`,()=>appearanceRead().opacity,value=>appearanceWrite("opacity",value),
      "Transparency of each outside-context group, including its readings: 100% is opaque. Zero hides it and removes invisible hit targets. Hover/focus uses at least 60% while retaining blur and darkening; stronger saved opacity is preserved.","35%",0,100,"1");
    syncContextAppearance = () => {
      const value=appearanceRead();
      appearanceMode.value=value.mode;
      appearanceFields.disabled=presentationReadOnly||value.mode==="hide";
      blurEnabled.checked=value.blurEnabled;darkeningEnabled.checked=value.darkeningEnabled;
      blur.disabled=!value.blurEnabled;darkening.disabled=!value.darkeningEnabled;
      for(const [input,amount] of [[blur,value.blur],[darkening,value.darkening],[opacity,value.opacity]] as const) {
        input.value=String(amount);input.removeAttribute("aria-invalid");
      }
    };
    listen(appearanceMode,"change",()=>{apply(()=>appearanceWrite("mode",appearanceMode.value as ContextAppearance["mode"]));syncContextAppearance();});
    checkbox(blurEnabled,value=>appearanceWrite("blurEnabled",value),()=>appearanceRead().blurEnabled,syncContextAppearance);
    checkbox(darkeningEnabled,value=>appearanceWrite("darkeningEnabled",value),()=>appearanceRead().darkeningEnabled,syncContextAppearance);
    syncContextAppearance();
    const scrolling=layoutSection("Scrolling","scrolling");
    const follow=toggle(scrolling,"Auto-follow",`JEL-${view}-Layout-follow`,layoutRead().follow,"Off shows the entire song and never follows playback/external seeks. Explicit lyric clicks still seek and recenter once. Untimed text never follows.","On");layoutInputs.set("follow",follow);checkbox(follow,value=>layoutWrite("follow",value),()=>layoutRead().follow);
    const transition=select(scrolling,"Transition",`JEL-${view}-Layout-transition`,[["classic","Classic"],["instant","Instant"],["smooth","Native smooth"]],layoutRead().transition,"Classic keeps the surface's CSS transition; all choices use the same fixed anchor. Native smooth uses the browser's duration and cancels on manual scroll input. Independent of the manual-resume policy.","Classic");layoutInputs.set("transition",transition);listen(transition,"change",()=>apply(()=>layoutWrite("transition",transition.value as LayoutProfile["transition"])));
    layoutNumber(scrolling,"anchor","Anchor (% from top)",0,100,"any","Preferred active center, 0–100% from the readable viewport top. Every newly active source block follows this fixed position. At 0% the block aligns with the readable top where song edges allow. Fitting active voices remain readable together; newer wins otherwise.",`${defaults.anchor}%`);
    const resume=select(scrolling,"Resume after browsing",`JEL-${view}-Layout-resume`,[["classic","Classic"],["delay","After delay"]],layoutRead().resume,"Classic conditionally resumes fixed-anchor following when active lyrics are in reach. After delay returns after the last actual manual scrolling, even offscreen; activity/annotations cannot end it early. Silence defers until a real target.","Classic");layoutInputs.set("resume",resume);listen(resume,"change",()=>apply(()=>layoutWrite("resume",resume.value as LayoutProfile["resume"])));
    layoutNumber(scrolling,"resumeDelay","Resume delay (s)",0,30,"0.05","Seconds 0–30 from the last actual manual scrolling. One owned timeout; more scrolling extends it. Auto-follow Off cancels it.",".75 s");
    if(SongLyrics?.Type==="Static") { contextFields.disabled=true;scrolling.disabled=true;heading(contextFields,"Untimed lyrics show the entire song; following is unavailable.","p") }
    const gap = numeric(fields, "Gap dots after (s)", `JEL-${view}-GapThreshold`, () => PresentationSettings.getCues(view).threshold,
      value => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), threshold: value }),
      "Minimum real silence across all voices. 0 disables dots; 100 means 100 seconds. Very short gaps use static dots.", "2 s", 0, undefined, "0.1", presentationReadOnly);
    gap.setAttribute("aria-label", `${viewTitle} gap dots threshold in seconds`);
    const cueMotion = toggle(fields, "Dot motion", `JEL-${view}-CueMotion`, PresentationSettings.getCues(view).motion,
      "Animated or static gap dots for this view, shared by Word and Line sources. Text presets never change this.", "On"); cueMotion.disabled = presentationReadOnly;
    checkbox(cueMotion, motion => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), motion }), () => PresentationSettings.getCues(view).motion);
    const cueWindow = document.createElement("input");
    cueWindow.id = `JEL-${view}-CueLastSeconds`;
    cueWindow.type = "number";
    cueWindow.min = "0";
    cueWindow.step = "any";
    cueWindow.placeholder = "Full gap";
    cueWindow.disabled = presentationReadOnly;
    cueWindow.setAttribute("aria-label", `${viewTitle} show gap dots for last seconds`);
    const syncCueWindow = () => {
      cueWindow.value = String(PresentationSettings.getCues(view).lastSeconds ?? "");
      cueWindow.removeAttribute("aria-invalid");
    };
    syncCueWindow();
    row(fields, "Show dots for last (s)", cueWindow,
      "Blank uses the full eligible gap. Enter a positive duration ending where the dots normally disappear before the next vocal. Minimum silence still decides which gaps qualify.", "Full gap");
    listen(cueWindow, "input", () => {
      const blank = cueWindow.value === "" && !cueWindow.validity.badInput;
      const value = cueWindow.valueAsNumber;
      if (!blank && (!cueWindow.validity.valid || !Number.isFinite(value) || value <= 0)) {
        cueWindow.setAttribute("aria-invalid", "true");
        status.textContent = "Enter positive seconds or leave blank for the full gap.";
        return;
      }
      cueWindow.removeAttribute("aria-invalid");
      apply(() => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), lastSeconds: blank ? null : value }), syncCueWindow);
    });
    listen(cueWindow, "blur", () => {
      if (!cueWindow.hasAttribute("aria-invalid")) return;
      syncCueWindow();
      status.textContent = "Restored the saved gap window.";
    });
    const readingGroups: HTMLDetailsElement[] = [];
    for (const sourceCase of SourceCases) {
      const details = document.createElement("details"); details.className = "BL-CaseSettings"; details.id = `JEL-${view}-${sourceCase}-Settings`;
      const summary = document.createElement("summary"); summary.textContent = `${sourceCase} sync`; details.append(summary); fields.append(details);
      const body = document.createElement("fieldset"); body.className = "BL-GroupOptions"; body.disabled = presentationReadOnly; details.append(body);
      const read = () => PresentationSettings.getRendering(view, sourceCase);
      const prefix = `JEL-${view}-${sourceCase}-`;
      const detail = sourceCase === "Word" ? select(body, "Text detail", prefix + "TextDetail", [["auto", "Auto"], ["line", "Line"], ["word", "Word"]], read().detail,
        "Choose how to display word-timed lyrics. Line uses this viewer’s Line sync text and reading settings. Auto and Word use the saved Word sync settings.", "Auto") : undefined;
      const appearance = detail ? document.createElement("fieldset") : body;
      if (detail) {
        detail.setAttribute("aria-label", `${viewTitle} Word text detail`);
        appearance.className = "BL-GroupOptions";
        body.append(appearance);
      }
      const preset = select(appearance, "Text preset", prefix + "TextPreset", [["classic", "Classic"], ["minimal", "Minimal"], ["balanced", "Balanced"], ["custom", "Custom"]], read().preset,
        "Editable effects for this display mode. Applying a named preset resets its easing and response to Classic.", "Classic");
      preset.setAttribute("aria-label", `${viewTitle} ${sourceCase} text preset`);
      const effectInputs = new Map<keyof RenderingProfile, HTMLInputElement>();
      const highlight = select(appearance, "Highlight", prefix + "TextHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], read().highlight,
        "Whole segment changes at its start. Progressive follows available timing and freezes in gaps. Off keeps solid text.", "Classic");
      highlight.setAttribute("aria-label", `${viewTitle} ${sourceCase} highlight`);
      for (const [key, text, help] of [
        ["scale", "Scale", "Scale movement; whole-line detail uses its existing active scale."],
        ["verticalMotion", "Vertical motion", "Word display detail only; whole-line detail stays on its baseline."],
        ["glow", "Glow", "Animated text glow, independent of inactive blur."],
        ["blur", "Inactive blur", "Blur vocals away from active voices."],
        ["emphasis", "Emphasis", "In Word display, runs with at least one second of voiced source time and up to 12 source graphemes get emphasis. Text that needs to stay joined moves as one segment. Ambiguous mappings across several source runs keep ordinary animation."],
      ] as const) {
        if (sourceCase === "Line" && (key === "verticalMotion" || key === "emphasis")) continue;
        const input = toggle(appearance, text, prefix + key, read()[key], help, "On"); effectInputs.set(key, input);
        input.setAttribute("aria-label", `${viewTitle} ${sourceCase} ${text.toLowerCase()}`);
        checkbox(input, value => PresentationSettings.saveRendering(view, sourceCase, { ...read(), [key]: value, preset: "custom" }), () => read()[key]);
      }
      const animation = document.createElement("details");
      animation.id = prefix + "Animation";
      animation.className = "BL-CaseSettings";
      heading(animation, sourceCase === "Line" ? "Whole-line animation" : "Word animation", "summary");
      const animationFields = document.createElement("fieldset");
      animationFields.className = "BL-GroupOptions";
      animation.append(animationFields);
      appearance.append(animation);
      const syncAnimation = animationControls(animationFields, prefix,
        `${viewTitle} ${sourceCase === "Line" ? "whole-line" : "word"} animation`, read,
        value => PresentationSettings.saveRendering(view, sourceCase, value), () => sync());
      let lineHint: HTMLElement | undefined;
      if (sourceCase === "Line") {
        heading(appearance, "These settings also apply when word-timed lyrics are displayed as Line.", "p");
      } else {
        lineHint = document.createElement("div");
        heading(lineHint, "Whole-line display uses this viewer’s Line sync settings for text and readings.", "p");
        const openLine = document.createElement("button");
        openLine.type = "button";
        openLine.textContent = "Open Line sync settings";
        openLine.setAttribute("aria-controls", `JEL-${view}-Line-Settings`);
        listen(openLine, "click", () => {
          const line = content.querySelector<HTMLDetailsElement>(`#JEL-${view}-Line-Settings`)!;
          line.open = true;
          line.querySelector("summary")?.focus();
        });
        lineHint.append(openLine);
        body.append(lineHint);
      }
      const sync = () => {
        const current = read();
        preset.value = current.preset;
        highlight.value = current.highlight;
        if (detail) detail.value = current.detail;
        for (const [key, input] of effectInputs) input.checked = current[key] as boolean;
        syncAnimation();
        if (lineHint) {
          const usesLine = current.detail === "line";
          appearance.hidden = usesLine;
          appearance.disabled = usesLine;
          lineHint.hidden = !usesLine;
        }
      };
      sync();
      listen(preset, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, preset.value === "custom" ? { ...read(), preset: "custom" } : ApplyTextPreset(read(), preset.value as "classic" | "minimal" | "balanced")), sync); sync(); });
      listen(highlight, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, { ...read(), highlight: highlight.value as RenderingProfile["highlight"], preset: "custom" }), sync); sync(); });
      for (const input of effectInputs.values()) listen(input, "change", sync);
      if (detail) listen(detail, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, { ...read(), detail: detail.value as RenderingProfile["detail"] }), sync); sync(); });
      const readingGroup = document.createElement("details"); readingGroup.className = "BL-CaseSettings";
      const readingTitle = document.createElement("summary"); readingGroups.push(readingGroup);
      readingTitle.textContent = "Reading effects"; readingGroup.append(readingTitle); appearance.append(readingGroup);
      const readingFields = document.createElement("fieldset"); readingFields.className = "BL-GroupOptions"; readingGroup.append(readingFields);
      const readAnnotations = () => PresentationSettings.getAnnotations(view);
      const readCase = () => readAnnotations().cases[sourceCase];
      const writeCase = (value: ReturnType<typeof readCase>) => {
        const current = readAnnotations(); PresentationSettings.saveAnnotations(view, { ...current, cases: { ...current.cases, [sourceCase]: value } });
      };
      const inherit = toggle(readingFields, "Use text effects", prefix + "ReadingInherit", readCase().inherit,
        "Secondary text and ruby inherit the displayed text’s effects. Off enables independent reading effects for this display mode.", "On");
      const custom = document.createElement("fieldset"); custom.className = "BL-GroupOptions"; readingFields.append(custom);
      const readingHighlight = select(custom, "Highlight", prefix + "ReadingHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], readCase().effects.highlight,
        "Reading highlight for this display mode. Grouped progress freezes in real source gaps.", "Use text effects");
      listen(readingHighlight, "change", () => apply(() => writeCase({ ...readCase(), effects: { ...readCase().effects, highlight: readingHighlight.value as RenderingProfile["highlight"], preset: "custom" } }), () => { readingHighlight.value = readCase().effects.highlight; }));
      for (const [key, text] of [["scale", "Scale"], ["verticalMotion", "Vertical motion"], ["glow", "Glow"], ["blur", "Inactive blur"]] as const) {
        if (sourceCase === "Line" && key === "verticalMotion") continue;
        const input = toggle(custom, text, prefix + "Reading-" + key, readCase().effects[key],
          "Independent reading effect for this display mode. Whole-line detail has no vertical motion. Off stops its effect work.", "Use text effects");
        checkbox(input, value => writeCase({ ...readCase(), effects: { ...readCase().effects, [key]: value, preset: "custom" } }), () => readCase().effects[key]);
      }
      const syncReadingAnimation = animationControls(custom, prefix + "Reading-", `${viewTitle} ${sourceCase} reading animation`,
        () => readCase().effects, effects => writeCase({ ...readCase(), effects }));
      if (sourceCase === "Word") {
        const emphasis = toggle(custom, "Emphasis", prefix + "Reading-emphasis", readCase().effects.emphasis,
          "Uses the same voiced source duration and source grapheme limits as lyric emphasis. Joined text can move as one segment. Ambiguous mappings across several source runs keep ordinary animation.", "Use text effects");
        checkbox(emphasis, value => writeCase({ ...readCase(), effects: { ...readCase().effects, emphasis: value, preset: "custom" } }), () => readCase().effects.emphasis);
      }
      const readingExpand = () => {
        custom.hidden = inherit.checked;
        custom.disabled = inherit.checked;
        syncReadingAnimation();
      };
      checkbox(inherit, value => writeCase({ ...readCase(), inherit: value }), () => readCase().inherit, readingExpand);
      readingExpand();
    }
    const placementSyncs: (() => void)[] = [];
    const styleRows = new Map<string, HTMLElement>();
    const readConversions = () => PresentationSettings.getConversions(view);
    const refreshStyles = () => {
      const conversions = readConversions();
      const choices = Object.values(conversions.languages).filter(choice => choice.enabled);
      const attached = choices.some(choice => choice.kind === "furigana");
      const above = choices.some(choice => choice.kind !== "furigana" && choice.placement === "above");
      // Effects affect reading roots only. Keep the saved case settings while
      // hiding/disabling them for Replace-only or conversion Off configurations.
      for (const details of readingGroups) {
        details.hidden = !conversions.enabled || !(attached || above);
        details.querySelector("fieldset")!.disabled = details.hidden;
      }
      for (const [key, control] of styleRows) {
        let visible = attached || above;
        if (key === "rubySize") visible = attached;
        else if (key === "secondarySize" || key === "gap") visible = above;
        control.hidden = !visible;
        for (const input of control.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) input.disabled = !visible;
      }
    };
    const annotationDetails = document.createElement("details"); annotationDetails.className = "BL-CaseSettings";
    const annotationTitle = document.createElement("summary"); annotationTitle.textContent = "Conversions"; annotationDetails.append(annotationTitle); fields.append(annotationDetails);
    const group = annotationDetails;
    const writeConversions = (value: ReturnType<typeof readConversions>) => PresentationSettings.saveConversions(view, value);
    const enabled = toggle(group, "Enabled", `JEL-${view}-ConversionsEnabled`, readConversions().enabled,
      "Convert supported languages in this view. Off displays original lyrics and stops this view's conversion work; choices are remembered.", "Off");
    enabled.disabled = presentationReadOnly;
    const options = document.createElement("fieldset"); options.className = "BL-GroupOptions"; group.append(options);
    const expand = () => { options.hidden = !enabled.checked; options.disabled = presentationReadOnly || !enabled.checked; refreshStyles(); };
    checkbox(enabled, value => writeConversions({ ...readConversions(), enabled: value }), () => readConversions().enabled, expand); expand();
    for (const language of PresentationLanguages) {
      const readChoice = () => readConversions().languages[language];
      const writeChoice = (patch: Partial<ReturnType<typeof readChoice>>) => { const current = readConversions(); writeConversions({ ...current, languages: { ...current.languages, [language]: { ...current.languages[language], ...patch } } }); };
      const input = toggle(options, language, `JEL-${view}-${language}`, readChoice().enabled, "Enable this language in this view. Unsupported text remains original.", "Off");
      input.setAttribute("aria-label", `${viewTitle} ${language} conversion`);
      const languageFields = document.createElement("fieldset"); languageFields.className = "BL-GroupOptions"; options.append(languageFields);
      const languageExpand = () => { languageFields.hidden = !input.checked; languageFields.disabled = !input.checked; refreshStyles(); };
      checkbox(input, value => writeChoice({ enabled: value }), () => readChoice().enabled, languageExpand); languageExpand();
      const kinds: [string, string][] = language === "Japanese" ? [["romaji", "Romaji"], ["kana", "Kana"], ["furigana", "Furigana"]] : language === "Chinese" ? [["pinyin", "Pinyin"]] : [["romaja", "Romaja"]];
      const kind = select(languageFields, "Conversion", `JEL-${view}-${language}-Conversion`, kinds, readChoice().kind,
        language === "Japanese" ? "Kana keeps written kana and particles. Romaji uses pronunciation. Furigana keeps original text with readings attached above kanji." : "Phonetic reading for this language; original text remains while loading or if unavailable.", language === "Japanese" ? "Romaji" : kinds[0][1]);
      const placements: [string, string][] = [["replace", "Replace"], ["above", "Above"]];
      if (language === "Japanese") placements.push(["attached", "Above kanji (attached)"]);
      const placement = select(languageFields, "Placement", `JEL-${view}-${language}-Placement`, placements, readChoice().placement,
        "Replace changes the displayed main text. Above adds a reading above each real voice. Furigana is always attached to its kanji and cannot replace the original; the previous row placement is remembered.", "Replace");
      const syncPlacement = () => { const attached = readChoice().kind === "furigana"; placement.value = attached ? "attached" : readChoice().placement; for (const option of placement.options) option.disabled = attached ? option.value !== "attached" : option.value === "attached"; placement.disabled = attached; refreshStyles(); };
      listen(kind, "change", () => { apply(() => writeChoice({ kind: kind.value as ReturnType<typeof readChoice>["kind"] }), () => { kind.value = readChoice().kind; }); syncPlacement(); });
      listen(placement, "change", () => { apply(() => writeChoice({ placement: placement.value as "replace" | "above" }), syncPlacement); syncPlacement(); });
      // Registered below after the shared style rows exist; there is no polling
      // watcher and detached controls are still protected by apply().
      placementSyncs.push(syncPlacement);
    }
    const annotationFields = document.createElement("fieldset"); annotationFields.className = "BL-GroupOptions"; options.append(annotationFields);
    const readAnnotations = () => PresentationSettings.getAnnotations(view);
    for (const [key, text, minimum, maximum, fallback] of [["secondarySize", "Row size", .25, 1.5, ".6"], ["rubySize", "Ruby size", .25, 1, ".5"], ["gap", "Row gap", 0, 2, ".15 em"], ["spacing", "Letter spacing", -.1, .5, "0 em"], ["opacity", "Opacity", 0, 1, ".8"]] as const) {
      const styleInput = numeric(annotationFields, text, `JEL-${view}-Reading-${key}`, () => readAnnotations()[key],
        value => PresentationSettings.saveAnnotations(view, { ...readAnnotations(), [key]: value }),
        key.endsWith("Size") ? "Relative to this voice's primary font size. Updates layout without requesting new readings." : "Reading style for this view. Spacing and gap use the reading's font size; opacity ranges from 0 to 1. Style changes reuse existing readings.", fallback, minimum, maximum, "0.05");
      styleRows.set(key, styleInput.closest(".BL-HelpRow") as HTMLElement);
    }
    const alignment = select(annotationFields, "Alignment", `JEL-${view}-ReadingAlignment`, [["inherit", "Follow voice"], ["start", "Start"], ["center", "Center"], ["end", "End"]], readAnnotations().alignment,
      "Secondary row alignment within its voice block; ruby alignment within each original source range. Start and End follow the lyric direction.", "Follow voice");
    listen(alignment, "change", () => apply(() => PresentationSettings.saveAnnotations(view, { ...readAnnotations(), alignment: alignment.value as "inherit" | "start" | "center" | "end" }), () => { alignment.value = readAnnotations().alignment; }));
    styleRows.set("alignment", alignment.closest(".BL-HelpRow") as HTMLElement);
    placementSyncs.forEach(sync => sync());
    if (presentationReadOnly) heading(fields, "Presentation settings require a newer version.", "p");
  }
  heading(content, "Spicy");
  const token = document.createElement("input"); token.id = "BL-SpicyToken"; token.type = "password"; token.autocomplete = "off"; token.spellcheck = false;
  token.placeholder = "Paste your client token"; token.value = GetSpicyToken();
  row(content, "API token", token, "Applies when editing finishes (blur or Enter). Empty disables this source. Key stays on this device; use the local relay.", "Empty (disabled)").classList.add("BL-TokenTile");
  const commitToken = () => apply(() => SetSpicyToken(token.value), () => { token.value = GetSpicyToken(); });
  listen(token, "change", commitToken);
  listen(token, "keydown", event => { if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); commitToken(); } });
  listen(token, "input", () => { status.textContent = "Token applies when editing finishes."; });
  content.append(status);
  (Spotify as any).PopupModal.display({ title: "Just Enough Lyrics Settings", content, isLarge: true });
  disposeTypography=CreateTypographyPreview(content,sizeOutputs,spacingOutputs);
  fetchMode.focus({ preventScroll: true });
  const scrollContainer = content.closest(".spicetify-popup-content"); if (scrollContainer) scrollContainer.scrollTop = 0;
}

export const ProviderControlsReady = OnSpotifyReady.then(() => {
  if (GlobalMaid.IsDestroyed()) return;
  // One bounded local probe per extension startup, even in on-demand mode.
  // No polling, upstream request or token transmission. Disposal cancels it.
  if (GetSpicyToken()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    GlobalMaid.Give(() => { clearTimeout(timeout); controller.abort(); });
    void fetch('http://127.0.0.1:8967/health', {
      signal: controller.signal, cache: 'no-store', credentials: 'omit',
    }).then(async response => {
      if (!response.ok || (await response.json()).service !== 'beautiful-lyrics-spicy-relay') {
        throw new Error('Relay unavailable');
      }
    }).catch(() => {
      if (!GlobalMaid.IsDestroyed() && GetSpicyToken()) {
        ShowNotification('Just Enough Lyrics: Spicy relay is unavailable. Run node spicy-proxy.mjs start to use Spicy.', 'warning', 8);
      }
    }).finally(() => clearTimeout(timeout));
  }
  // Use Spicetify's right-side registration, exactly as Comfy does. The host
  // handles nav remounts; no additional DOM observer or polling loop is needed.
  const button = new (Spotify as any).Topbar.Button(
    "Just Enough Lyrics Settings",
    Icons.LyricsPage,
    OpenProviderSettings,
    false,
    true,
  );
  GlobalMaid.Give(() => {
    button.element.style.display = "none";
    button.element.remove();
    button.button.onclick = null;
    button.tippy?.destroy();
  });
});

export function SetupProviderControls(controls: HTMLElement, maid: Maid) {
  const button = document.createElement("button");
  button.className = "ViewControl BL-OptionsButton";
  button.type = "button";
  button.setAttribute("aria-label", "Additional Options");
  button.setAttribute("aria-haspopup", "dialog");
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  controls.prepend(maid.Give(button));
  const panel = document.createElement("div");
  panel.className = "BL-ProviderMenu";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Additional Options");
  const heading = document.createElement("h3");
  heading.textContent = "Additional Options";
  const label = document.createElement("label");
  label.textContent = "Lyrics Provider";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Lyrics Provider");
  label.append(select);
  panel.append(heading, label);
  const update = () => {
    select.replaceChildren();
    for (const lyrics of SongLyricChoices) {
      const option = document.createElement("option");
      option.value = lyrics.Source!.Provider;
      const selected = option.value === SongLyrics?.Source?.Provider;
      const effective = selected ? SongLyrics! : lyrics;
      option.textContent =
        option.value +
        (effective.Source?.HasWordSync
          ? " (word sync)"
          : effective.Type === "Static"
            ? " (plain text)"
            : "");
      option.selected = selected;
      select.append(option);
    }
    select.disabled = !SongLyricChoices.length;
    if (select.disabled) {
      const option = document.createElement("option");
      option.textContent = "No available providers";
      select.append(option);
    }
  };
  select.onchange = () => SelectLyricsProvider(select.value);
  // Spotify's tooltip renderer stringifies DOM content. Supply our own small
  // renderer so the select remains an interactive element with its listeners.
  const popup = (Spotify as any).Tippy(button, {
    render() {
      const popper = document.createElement("div");
      popper.append(panel);
      return { popper };
    },
    animation: false,
    delay: 0,
    trigger: "click",
    interactive: true,
    placement: "bottom-start",
    appendTo: () => document.fullscreenElement || document.body,
    onShow() {
      update();
      controls.classList.add("BL-ProviderOpen");
      button.setAttribute("aria-expanded", "true");
    },
    onHide() {
      controls.classList.remove("BL-ProviderOpen");
      button.setAttribute("aria-expanded", "false");
    },
  });
  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      popup.hide();
      button.focus();
    }
  };
  panel.addEventListener("keydown", keydown);
  maid.Give(() => {
    popup.destroy();
    select.onchange = null;
    panel.removeEventListener("keydown", keydown);
  });
  maid.Give(
    SongChanged.Connect(() => {
      popup.hide();
      update();
    }),
  );
  maid.Give(SongLyricsLoaded.Connect(update));
  update();
}
