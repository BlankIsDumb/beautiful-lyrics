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
  IsProviderEnabled,
} from "@Spices/Spicetify/Services/Player/ProviderSettings.ts";
import {
  SongLyrics,
  ReloadLyrics,
} from "@Spices/Spicetify/Services/Player/mod.ts";
import type { Maid } from "@Universal/Modules/Maid.ts";
import Icons from "./LyricViews/Icons.ts";
import { PresentationSettings, PresentationLanguages, type PresentationView } from "./PresentationSettings.ts";
import type { HorizontalSurface } from "./HorizontalSpacing.ts";
import { TimingSettings } from "./TimingSettings.ts";
import { SaveTimingOffset, SaveLayoutField, SaveBackgroundField, TimingOffsetInput, PrimarySizeInput } from "./ViewSettingsControls.ts";
import { SetupCornerControls } from "./CornerControls.ts";
import { ApplyTextPreset, SourceCases, type RenderingProfile } from "./RenderingSettings.ts";
import { CreateSettingsHelp, BackgroundHelp, LyricsCacheHelp } from "./SettingsHelp.ts";
import { LyricsCacheScopes, GetLyricsCacheCounts, ClearLyricsCache, type LyricsCacheScope } from "@Spices/Spicetify/Services/Player/LyricsCache.ts";
import { ClassicBackground, DefaultBackgrounds, type BackgroundProfile } from "./BackgroundSettings.ts";
import { DefaultLayouts, NormalizeFontFamily, type LayoutProfile, type LayoutCategory } from "./LayoutSettings.ts";
import type { ContextAppearance } from "./ContextAppearance.ts";
import { CreateTypographyPreview, TypographyMeasured } from "./Modules/LyricsRenderer/TypographyPreview.ts";
import "./Stylings/ProviderControls.scss";

export function OpenProviderSettings() {
  const content = document.createElement("form");
  content.className = "BL-Settings";
  content.tabIndex = -1;
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
  const sectionBlock = (text: string) => {
    const section = document.createElement("section"); content.append(section); heading(section, text);
    const block = document.createElement("div"); block.className = "BL-Block"; section.append(block); return block;
  };
  const buttonRow = (parent: HTMLElement) => {
    const buttons = document.createElement("div"); buttons.className = "BL-ButtonRow"; parent.append(buttons); return buttons;
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
  const formatLeading = (leading: number) => String(Number(leading.toFixed(4)));
  const numeric = (parent: HTMLElement, text: string, id: string, read: () => number, write: (value: number) => void,
    help: string, classic: string, minimum: number, maximum?: number, step = "0.05", disabled = false,
    format?: (value: number) => string) => {
    const display = () => format ? format(read()) : String(read());
    const input = document.createElement("input"); input.type = "number"; input.id = id; input.required = true;
    input.min = String(minimum); if (maximum !== undefined) input.max = String(maximum);
    input.step = step; input.value = display(); input.disabled = disabled;
    input.setAttribute("aria-label", text); row(parent, text, input, help, classic);
    const valid = () => input.value.trim() !== "" && input.validity.valid && Number.isFinite(input.valueAsNumber);
    listen(input, "input", () => {
      if (!valid()) { input.setAttribute("aria-invalid", "true"); status.textContent = "Enter a valid number; the previous value is still active."; return; }
      input.removeAttribute("aria-invalid");
      // Display rounding must never turn an untouched stored value into a save.
      if (format && input.value === display()) return;
      apply(() => write(input.valueAsNumber), () => { input.value = display(); });
    });
    listen(input, "blur", () => {
      if (valid()) return;
      input.value = display(); input.removeAttribute("aria-invalid");
      status.textContent = "Invalid number discarded; the previous value is still active.";
    });
    return input;
  };
  const animationControls = (parent: HTMLElement, prefix: string, scope: string, read: () => RenderingProfile,
    write: (value: RenderingProfile) => void, after?: () => void) => {
    const easing = select(parent, "Easing", prefix + "AnimationEasing", [["classic", "Classic"], ["linear", "Linear"],
      ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in/out"]], read().animationEasing,
      "How effect animations ease between states. Linear moves at a constant rate.", "Classic");
    const response = select(parent, "Response", prefix + "AnimationResponse", [["classic", "Classic"], ["slow", "Slow"],
      ["fast", "Fast"], ["direct", "Direct"]], read().animationResponse,
      "How quickly effects react. Direct has no lag or bounce. Lyric timing isn't affected.", "Classic");
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
  const behaviorSection = sectionBlock("Behavior");
  const fetchMode = select(behaviorSection, "Fetch lyrics", "BL-FetchMode", [["change", "On song change"], ["required", "When required"]], GetBehaviorSettings().fetchMode,
    "On song change loads lyrics as each song starts. When required waits until a view shows lyrics. Now Playing counts while enabled.", "On song change");
  listen(fetchMode, "change", () => apply(() => SaveBehaviorSettings({ ...GetBehaviorSettings(), fetchMode: fetchMode.value as "change" | "required" }), () => { fetchMode.value = GetBehaviorSettings().fetchMode; }));
  const cacheScope = select(behaviorSection, "Lyrics cache", "BL-LyricsCache", LyricsCacheScopes.map(scope => [scope, scope] as const), "All", LyricsCacheHelp, "");
  const clearCache = document.createElement("button"); clearCache.type = "button"; clearCache.id = "BL-ClearLyricsCache"; clearCache.textContent = "Clear";
  cacheScope.closest(".BL-HelpRow")!.append(clearCache);
  let countGeneration = 0;
  const refreshCacheCounts = async () => {
    const generation = ++countGeneration;
    const counts = await GetLyricsCacheCounts();
    if (lifetime.signal.aborted || generation !== countGeneration) return;
    for (const option of cacheScope.options) {
      const scope = option.value as LyricsCacheScope;
      option.textContent = `${scope} (${counts[scope] ?? "unavailable"})`;
    }
  };
  // Count keys only, once per open/clear. This never starts provider requests or
  // runs a settings migration, and a detached form cannot receive late updates.
  void refreshCacheCounts();
  listen(clearCache, "click", async () => {
    clearCache.disabled = true; cacheScope.disabled = true;
    ++countGeneration;
    try {
      const result = await ClearLyricsCache(cacheScope.value as LyricsCacheScope, ReloadLyrics);
      if (lifetime.signal.aborted) return;
      status.textContent = `Removed ${result.removed} cache ${result.removed === 1 ? "entry" : "entries"}.${result.failed ? " Some entries could not be cleared on this device." : ""}`;
      await refreshCacheCounts();
    } catch {
      if (!lifetime.signal.aborted) status.textContent = "Could not clear lyrics cache on this device.";
    } finally {
      if (!lifetime.signal.aborted) { clearCache.disabled = false; cacheScope.disabled = false; }
    }
  });
  const timingReadOnly = TimingSettings.isReadOnly(), presentationReadOnly = PresentationSettings.isReadOnly();
  const timings = sectionBlock("Timings");
  const addTiming = (scope: "Shared" | PresentationView, parent: HTMLElement) => numeric(parent,
    scope === "Shared" ? "Lyric delay (s)" : scope === "NowPlaying" ? "Now Playing offset (s)" : "Fullscreen offset (s)", `JEL-${scope}-TimingOffset`, () => TimingSettings.get(scope),
    value => SaveTimingOffset(scope, value),
    scope === "Shared" ? "Shifts lyrics in every view. Positive is later, negative is earlier." : scope === "NowPlaying" ? "Added to Lyric delay in Now Playing only." : "Added to Lyric delay in Fullscreen only.", "0 s", TimingOffsetInput.min, TimingOffsetInput.max, TimingOffsetInput.step, timingReadOnly);
  const shared = addTiming("Shared", timings); shared.setAttribute("aria-label", "Shared lyric delay in seconds");
  // Timing controls live outside the optional Now Playing subtree so its switch
  // cannot disable offsets. Existing timing storage and read-only rules still apply.
  for (const view of ["NowPlaying", "FullLyrics"] as const) {
    const delay = addTiming(view, timings);
    delay.setAttribute("aria-label", `${view === "NowPlaying" ? "Now Playing" : "Fullscreen"} offset in seconds`);
    if (view === "FullLyrics") delay.setAttribute("aria-description", "Fullscreen, cinema and lyrics page share this viewer.");
  }
  const holdDetails = document.createElement("details"); holdDetails.className = "BL-CaseSettings";
  const holdTitle = document.createElement("summary"); holdTitle.textContent = "Hold highlight across gaps";
  holdDetails.append(holdTitle); timings.append(holdDetails);
  const holdOptions = document.createElement("fieldset"); holdOptions.className = "BL-GroupOptions"; holdDetails.append(holdOptions);
  numeric(holdOptions, "Gap limit (s)", "BL-RichSyncHoldSeconds",
    () => GetRichSyncSettings().holdSeconds, value => SaveRichSyncSetting("holdSeconds", value),
    "Keeps the finished line lit through pauses shorter than this, instead of dimming and showing dots. 0 turns holding off. Musixmatch, LRCLIB and Spotify only.",
    "", 0, undefined, "0.1");
  const holdWordSync = toggle(holdOptions, "Apply to word sync", "BL-RichSyncHoldWordSync", GetRichSyncSettings().holdWordSync,
    "Off holds line-synced lyrics only. On also holds word-synced lyrics.", "On");
  checkbox(holdWordSync, value => SaveRichSyncSetting("holdWordSync", value), () => GetRichSyncSettings().holdWordSync);
  numeric(timings, "Minimum timed segments per line", "BL-RichSyncMinimumSegments",
    () => GetRichSyncSettings().minimumSegmentsPerLine, value => SaveRichSyncSetting("minimumSegmentsPerLine", value),
    "Word-synced lyrics averaging fewer timed segments per line than this are shown as line sync. 0 turns this off. Musixmatch, LRCLIB and Spotify only.",
    "", 0, undefined, "0.1");
  if (timingReadOnly) heading(timings, "Timing settings require a newer version.", "p");
  for (const view of ["NowPlaying", "FullLyrics"] as const) {
    const viewTitle = view === "NowPlaying" ? "Now Playing" : "Fullscreen";
    const block = sectionBlock(viewTitle), section = block.parentElement!; section.className = "BL-ViewSettings";
    const title = section.querySelector("h3")!; title.id = `JEL-${view}-Heading`; section.setAttribute("aria-labelledby", title.id);
    let sidebar: HTMLInputElement | undefined;
    if (view === "NowPlaying") {
      sidebar = toggle(block, "Enabled", "BL-SidebarEnabled", GetBehaviorSettings().sidebarEnabled, "Shows lyrics in the Now Playing panel. Off hides the options below and keeps them.", "On");
      sidebar.closest(".BL-HelpRow")!.classList.add("BL-GroupHeader");
    }
    const fields = document.createElement("fieldset"); fields.className = "BL-ViewOptions"; fields.id = `JEL-${view}-Options`; block.append(fields);
    if (sidebar) {
      sidebar.setAttribute("aria-label", "Now Playing enabled"); sidebar.setAttribute("aria-controls", fields.id);
      const expansion = () => { fields.hidden = !sidebar!.checked; fields.disabled = !sidebar!.checked; sidebar!.setAttribute("aria-expanded", String(sidebar!.checked)); TypographyMeasured(); };
      checkbox(sidebar, value => SaveBehaviorSettings({ ...GetBehaviorSettings(), sidebarEnabled: value }), () => GetBehaviorSettings().sidebarEnabled, expansion); expansion();
    }
    if (view === "NowPlaying") {
      const height = select(fields, "Card height", "JEL-NowPlaying-Layout-cardHeight",
        [["default", "Default"], ["extended", "Extended"], ["max", "Max"]], PresentationSettings.getLayout(view).cardHeight,
        "Height of the lyrics card. Default is 340 px, Extended 500 px, Max 620 px. Max also keeps one earlier line visible above the current one, unless Anchor is changed.", "Default");
      height.disabled = presentationReadOnly;
      listen(height, "change", () => {
        apply(() => SaveLayoutField("NowPlaying", "cardHeight", height.value as LayoutProfile["cardHeight"]));
        height.value = PresentationSettings.getLayout("NowPlaying").cardHeight;
      });
    }
    const backgroundGroup = document.createElement("details"), backgroundSummary = document.createElement("summary"), backgroundFields = document.createElement("fieldset");
    backgroundGroup.className = "BL-CaseSettings"; backgroundSummary.textContent = "Background";
    backgroundFields.className = "BL-GroupOptions"; backgroundFields.disabled = presentationReadOnly;
    backgroundGroup.append(backgroundSummary, backgroundFields); fields.append(backgroundGroup);
    const backgroundRead = () => PresentationSettings.getBackground(view);
    const backgroundWrite = <K extends keyof BackgroundProfile>(key: K, value: BackgroundProfile[K]) =>
      SaveBackgroundField(view, key, value);
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
    backgroundSelect("fps", "Frame rate", [["uncapped", "Uncapped"], ["60", "60 fps"], ["30", "30 fps"], ["15", "15 fps"]], "");
    backgroundSelect("resolution", "Resolution", [["full", "Full"], ["half", "Half"], ["quarter", "Quarter"]], "");
    const backgroundButtons = buttonRow(backgroundFields);
    for (const classic of [true, false]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = classic ? "Classic background" : "Reset background";
      backgroundButtons.append(button);
      listen(button, "click", () => {
        apply(() => PresentationSettings.saveBackground(view, classic ? ClassicBackground(backgroundRead()) : { ...DefaultBackgrounds[view] }));
        syncBackground();
      });
    }
    syncBackground();
    const defaults=DefaultLayouts[view];
    const layoutRead=()=>PresentationSettings.getLayout(view);
    const layoutWrite=<K extends keyof LayoutProfile>(key: K,value: LayoutProfile[K])=>SaveLayoutField(view,key,value);
    const layoutInputs=new Map<keyof LayoutProfile, HTMLInputElement|HTMLSelectElement>();
    // Reset handlers are registered before the Context controls are created.
    // The callback is assigned below and runs only for later user actions.
    let syncContextAppearance = () => {};
    const layoutSection=(title: string,category: LayoutCategory)=>{
      const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("fieldset");
      details.className="BL-CaseSettings";summary.textContent=title;body.className="BL-GroupOptions";body.disabled=presentationReadOnly;
      details.append(summary,body);fields.append(details);
      const reset=document.createElement("button");reset.type="button";reset.textContent=category==="scrolling"?`Reset scrolling (${defaults.anchor}% anchor)`:category==="context"?"Reset context":`Classic ${title.toLowerCase()}`;buttonRow(body).append(reset);
      listen(reset,"click",()=>{if(category==="typography")for(const surface of (view==="NowPlaying"?["Card"]:["Contained","Fullscreen"]) as HorizontalSurface[])spacingControls.get(surface)?.cancel();apply(()=>PresentationSettings.resetLayout(view,category));for(const control of spacingControls.values())control.sync();for(const [key,input] of layoutInputs){const value=layoutRead()[key];if(input instanceof HTMLInputElement&&input.type==="checkbox")input.checked=value as boolean;else input.value=key==="leading"?formatLeading(value as number):value===null?"":String(value)}if(category==="context")syncContextAppearance();});
      return body;
    };
    const layoutNumber=(parent: HTMLElement,key: keyof LayoutProfile,label: string,min: number,max: number,step: string,help: string,classic: string)=>{
      const input=numeric(parent,label,`JEL-${view}-Layout-${key}`,()=>layoutRead()[key] as number,value=>layoutWrite(key,value),help,classic,min,max,step,presentationReadOnly,key==="leading"?formatLeading:undefined);layoutInputs.set(key,input);return input;
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
    const primary=layoutNumber(typography,"primaryRatio","Primary size (×)",PrimarySizeInput.min,PrimarySizeInput.max,PrimarySizeInput.step,"Scales lyric text, 0.5–2×. The resulting pixel size is shown below.","1×");
    const primaryOutput=document.createElement("output");primaryOutput.htmlFor=primary.id;primaryOutput.setAttribute("aria-label",`${viewTitle} resolved primary CSS pixels`);primary.closest(".BL-HelpRow")!.append(primaryOutput);
    const backing=layoutNumber(typography,"backingRatio","Backing size (× primary)",.5,1,"0.05","Size of background vocals, 0.5–1× of the primary size.",".75×");
    const backingOutput=document.createElement("output");backingOutput.htmlFor=backing.id;backingOutput.setAttribute("aria-label",`${viewTitle} resolved backing CSS pixels`);backing.closest(".BL-HelpRow")!.append(backingOutput);sizeOutputs.set(view,{primary:primaryOutput,backing:backingOutput});
    layoutNumber(typography,"leadWeight","Lead weight",100,900,"100","Boldness of main lyrics, 100–900. The font must include that weight.","700");
    layoutNumber(typography,"backingWeight","Backing weight",100,900,"100","Boldness of background vocals, 100–900.","500");
    layoutNumber(typography,"leading","Line height",1,2.5,"any","Space between wrapped rows of one lyric line, 1–2.5×.","1.18");
    nullable(typography,"groupGap","Between lines (em)",0,2,"0.05","Classic","Space between lyric lines, 0–2 em. Empty uses the original spacing.","Original");
    for (const [surface, surfaceTitle] of (view === "NowPlaying" ? [["Card", "Sidecard"]] : [["Contained", "Lyrics page"], ["Fullscreen", "Fullscreen"]]) as [HorizontalSurface, string][]) {
      const lease = PresentationSettings.createHorizontalPreview(surface);
      const range = document.createElement("input"), number = document.createElement("input");
      range.type = "range"; number.type = "number";
      range.id = `JEL-${surface}-HorizontalSpacing`; number.id = `${range.id}-Number`;
      for (const input of [range, number]) { input.min="-100";input.max="100";input.step="1";input.disabled=presentationReadOnly; }
      number.required=true;
      range.setAttribute("aria-label", `${surfaceTitle} horizontal spacing`);
      number.setAttribute("aria-label", `${surfaceTitle} horizontal spacing adjustment`);
      const help = "Positive narrows the lyrics column, negative widens it, −100 to 100. 0 is the default width." + (surface === "Contained" ? " Lyrics page only." : surface === "Fullscreen" ? " Fullscreen and cinema only." : "");
      row(typography,`${surfaceTitle} horizontal spacing`,range,help,"0");
      // The help helper owns one accessible row. Both editing controls share it;
      // synchronization assigns values directly, never synthetic input events.
      const container=range.closest<HTMLElement>(".BL-HelpRow")!;container.classList.add("BL-HorizontalSpacing");number.setAttribute("aria-describedby",range.getAttribute("aria-describedby")!);container.append(number);
      const output=document.createElement("output");output.htmlFor=`${range.id} ${number.id}`;output.setAttribute("aria-label",`${surfaceTitle} resolved horizontal column CSS pixels`);container.append(output);spacingOutputs.set(surface,output);
      const reset=document.createElement("button");reset.type="button";reset.textContent=`Reset ${surfaceTitle.toLowerCase()} spacing`;reset.disabled=presentationReadOnly;typography.querySelector(".BL-ButtonRow")!.append(reset);
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
    nullable(contextFields,"before","Lines before",0,Number.MAX_SAFE_INTEGER,"1","All","Lines shown before the current one. Empty shows all.",String(defaults.before ?? "All"));
    nullable(contextFields,"after","Lines after",0,Number.MAX_SAFE_INTEGER,"1","All","Lines shown after the current one. Empty shows all. Manual scrolling shows the whole song.","All");
    const appearanceRead = () => PresentationSettings.getContextAppearance(view);
    const appearanceWrite = <K extends keyof ContextAppearance>(key: K, value: ContextAppearance[K]) =>
      PresentationSettings.saveContextAppearance(view, { ...appearanceRead(), [key]: value });
    const appearanceMode = select(contextFields,"Outside context",`JEL-${view}-Context-mode`,[["hide","Hide"],["muted","Show muted lyrics"]],appearanceRead().mode,
      "Hide removes lines outside that range. Show muted dims them and keeps them clickable.","Hide");
    const appearanceFields = document.createElement("fieldset"); appearanceFields.className="BL-ContextAppearance";contextFields.append(appearanceFields);
    const blurEnabled = toggle(appearanceFields,"Blur",`JEL-${view}-Context-blurEnabled`,appearanceRead().blurEnabled,
      "Blurs muted lines.","On");
    const blur = numeric(appearanceFields,"Blur amount (px)",`JEL-${view}-Context-blur`,()=>appearanceRead().blur,value=>appearanceWrite("blur",value),
      "Blur strength for muted lines, 0–12 px.","2 px",0,12,"0.25");
    const darkeningEnabled = toggle(appearanceFields,"Darkening",`JEL-${view}-Context-darkeningEnabled`,appearanceRead().darkeningEnabled,
      "Darkens muted lines.","On");
    const darkening = numeric(appearanceFields,"Darkening (%)",`JEL-${view}-Context-darkening`,()=>appearanceRead().darkening,value=>appearanceWrite("darkening",value),
      "0% is no change, 100% is black.","60%",0,100,"1");
    const opacity = numeric(appearanceFields,"Opacity (%)",`JEL-${view}-Context-opacity`,()=>appearanceRead().opacity,value=>appearanceWrite("opacity",value),
      "Opacity of muted lines. 0% hides them. Hovering raises it to at least 60%.","35%",0,100,"1");
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
    const follow=toggle(scrolling,"Auto-follow",`JEL-${view}-Layout-follow`,layoutRead().follow,"Scrolls along with the song. Off shows the whole song. Clicking a line still seeks.","On");layoutInputs.set("follow",follow);checkbox(follow,value=>layoutWrite("follow",value),()=>layoutRead().follow);
    const transition=select(scrolling,"Transition",`JEL-${view}-Layout-transition`,[["classic","Classic"],["instant","Instant"],["smooth","Native smooth"]],layoutRead().transition,"How the view moves to the next line. Native smooth stops on manual scrolling.","Classic");layoutInputs.set("transition",transition);listen(transition,"change",()=>apply(()=>layoutWrite("transition",transition.value as LayoutProfile["transition"])));
    layoutNumber(scrolling,"anchor","Anchor (% from top)",0,100,"any","Where the current line sits, from 0% (top) to 100% (bottom).",`${defaults.anchor}%`);
    const resume=select(scrolling,"Resume after browsing",`JEL-${view}-Layout-resume`,[["classic","Classic"],["delay","After delay"]],layoutRead().resume,"Classic resumes following once the current line is back in reach. After delay resumes after a set time.","Classic");layoutInputs.set("resume",resume);listen(resume,"change",()=>apply(()=>layoutWrite("resume",resume.value as LayoutProfile["resume"])));
    layoutNumber(scrolling,"resumeDelay","Resume delay (s)",0,30,"0.05","Seconds after manual scrolling before following resumes, 0–30.",".75 s");
    if(SongLyrics?.Type==="Static") { contextFields.disabled=true;scrolling.disabled=true;heading(contextFields,"Untimed lyrics show the whole song, so following is off.","p") }
    // Finish construction before moving reset rows to the end of their groups.
    // Each button keeps its original disabled fieldset owner and event handler.
    for (const body of [typography, contextFields, scrolling]) body.append(body.querySelector(":scope > .BL-ButtonRow")!);
    const gapDetails = document.createElement("details"); gapDetails.className = "BL-CaseSettings";
    heading(gapDetails, "Gap dots", "summary"); fields.append(gapDetails);
    const gapFields = document.createElement("fieldset"); gapFields.className = "BL-GroupOptions"; gapDetails.append(gapFields);
    const gap = numeric(gapFields, "Show after (s)", `JEL-${view}-GapThreshold`, () => PresentationSettings.getCues(view).threshold,
      value => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), threshold: value }),
      "Shows dots in pauses at least this long. 0 turns dots off.", "2 s", 0, undefined, "0.1", presentationReadOnly);
    gap.setAttribute("aria-label", `${viewTitle} gap dots threshold in seconds`);
    const cueMotion = toggle(gapFields, "Dot motion", `JEL-${view}-CueMotion`, PresentationSettings.getCues(view).motion,
      "Animates the dots.", "On"); cueMotion.disabled = presentationReadOnly;
    checkbox(cueMotion, motion => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), motion }), () => PresentationSettings.getCues(view).motion);
    const cueWindow = document.createElement("input");
    cueWindow.id = `JEL-${view}-CueLastSeconds`;
    cueWindow.type = "number";
    cueWindow.min = "0";
    cueWindow.step = "any";
    cueWindow.placeholder = "Full";
    cueWindow.disabled = presentationReadOnly;
    cueWindow.setAttribute("aria-label", `${viewTitle} show gap dots for last seconds`);
    const syncCueWindow = () => {
      cueWindow.value = String(PresentationSettings.getCues(view).lastSeconds ?? "");
      cueWindow.removeAttribute("aria-invalid");
    };
    syncCueWindow();
    row(gapFields, "Show for last (s)", cueWindow,
      "Shows dots only for the last part of a pause. Empty shows them for the whole pause.", "Full gap");
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
        "How word-synced lyrics are shown. Line uses the Line sync settings. Auto and Word use the settings below.", "Auto") : undefined;
      const appearance = detail ? document.createElement("fieldset") : body;
      if (detail) {
        detail.setAttribute("aria-label", `${viewTitle} Word text detail`);
        appearance.className = "BL-GroupOptions";
        body.append(appearance);
      }
      const preset = select(appearance, "Text preset", prefix + "TextPreset", [["classic", "Classic"], ["minimal", "Minimal"], ["balanced", "Balanced"], ["custom", "Custom"]], read().preset,
        "Starting point for the effects below. Changing an effect switches to Custom.", "Classic");
      preset.setAttribute("aria-label", `${viewTitle} ${sourceCase} text preset`);
      const effectInputs = new Map<keyof RenderingProfile, HTMLInputElement>();
      const highlight = select(appearance, "Highlight", prefix + "TextHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], read().highlight,
        "Whole segment lights each part at once. Progressive fills it with the timing. Off keeps text solid.", "Classic");
      highlight.setAttribute("aria-label", `${viewTitle} ${sourceCase} highlight`);
      for (const [key, text, help] of [
        ["scale", "Scale", "Grows the active lyric."],
        ["verticalMotion", "Vertical motion", "Lifts active words slightly."],
        ["glow", "Glow", "Adds a glow to active lyrics."],
        ["blur", "Inactive blur", "Blurs lyrics that aren't active."],
        ["emphasis", "Emphasis", "Extra animation on long-held words."],
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
        heading(appearance, "These settings also apply when word-synced lyrics are shown as Line.", "p");
      } else {
        lineHint = document.createElement("div");
        heading(lineHint, "Line display uses the Line sync settings.", "p");
        const openLine = document.createElement("button");
        openLine.type = "button";
        openLine.textContent = "Open Line sync settings";
        openLine.setAttribute("aria-controls", `JEL-${view}-Line-Settings`);
        listen(openLine, "click", () => {
          const line = content.querySelector<HTMLDetailsElement>(`#JEL-${view}-Line-Settings`)!;
          line.open = true;
          line.querySelector("summary")?.focus();
        });
        buttonRow(lineHint).append(openLine);
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
        "Readings use the same effects as the lyrics. Off sets them separately.", "On");
      const custom = document.createElement("fieldset"); custom.className = "BL-GroupOptions"; readingFields.append(custom);
      const readingHighlight = select(custom, "Highlight", prefix + "ReadingHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], readCase().effects.highlight,
        "Highlight style for readings.", "Use text effects");
      listen(readingHighlight, "change", () => apply(() => writeCase({ ...readCase(), effects: { ...readCase().effects, highlight: readingHighlight.value as RenderingProfile["highlight"], preset: "custom" } }), () => { readingHighlight.value = readCase().effects.highlight; }));
      for (const [key, text] of [["scale", "Scale"], ["verticalMotion", "Vertical motion"], ["glow", "Glow"], ["blur", "Inactive blur"]] as const) {
        if (sourceCase === "Line" && key === "verticalMotion") continue;
        const input = toggle(custom, text, prefix + "Reading-" + key, readCase().effects[key],
          "Applies this effect to readings.", "Use text effects");
        checkbox(input, value => writeCase({ ...readCase(), effects: { ...readCase().effects, [key]: value, preset: "custom" } }), () => readCase().effects[key]);
      }
      const syncReadingAnimation = animationControls(custom, prefix + "Reading-", `${viewTitle} ${sourceCase} reading animation`,
        () => readCase().effects, effects => writeCase({ ...readCase(), effects }));
      if (sourceCase === "Word") {
        const emphasis = toggle(custom, "Emphasis", prefix + "Reading-emphasis", readCase().effects.emphasis,
          "Extra animation on readings of long-held words.", "Use text effects");
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
    const group = document.createElement("fieldset"); group.className = "BL-GroupOptions"; annotationDetails.append(group);
    const writeConversions = (value: ReturnType<typeof readConversions>) => PresentationSettings.saveConversions(view, value);
    const enabled = toggle(group, "Enabled", `JEL-${view}-ConversionsEnabled`, readConversions().enabled,
      "Converts supported languages in this view. Off shows the original lyrics.", "Off");
    enabled.disabled = presentationReadOnly;
    const options = document.createElement("fieldset"); options.className = "BL-GroupOptions"; group.append(options);
    const expand = () => { options.hidden = !enabled.checked; options.disabled = presentationReadOnly || !enabled.checked; refreshStyles(); };
    checkbox(enabled, value => writeConversions({ ...readConversions(), enabled: value }), () => readConversions().enabled, expand); expand();
    for (const language of PresentationLanguages) {
      const readChoice = () => readConversions().languages[language];
      const writeChoice = (patch: Partial<ReturnType<typeof readChoice>>) => { const current = readConversions(); writeConversions({ ...current, languages: { ...current.languages, [language]: { ...current.languages[language], ...patch } } }); };
      const input = toggle(options, language, `JEL-${view}-${language}`, readChoice().enabled, "Converts this language. Other text stays as is.", "Off");
      input.setAttribute("aria-label", `${viewTitle} ${language} conversion`);
      const languageFields = document.createElement("fieldset"); languageFields.className = "BL-GroupOptions"; options.append(languageFields);
      const languageExpand = () => { languageFields.hidden = !input.checked; languageFields.disabled = !input.checked; refreshStyles(); };
      checkbox(input, value => writeChoice({ enabled: value }), () => readChoice().enabled, languageExpand); languageExpand();
      const kinds: [string, string][] = language === "Japanese" ? [["romaji", "Romaji"], ["kana", "Kana"], ["furigana", "Furigana"]] : language === "Chinese" ? [["pinyin", "Pinyin"]] : [["romaja", "Romaja"]];
      const kind = select(languageFields, "Conversion", `JEL-${view}-${language}-Conversion`, kinds, readChoice().kind,
        language === "Japanese" ? "Romaji spells by sound. Kana converts to kana. Furigana adds readings above kanji." : "Reading shown for this language.", language === "Japanese" ? "Romaji" : kinds[0][1]);
      const placements: [string, string][] = [["replace", "Replace"], ["above", "Above"]];
      if (language === "Japanese") placements.push(["attached", "Above kanji (attached)"]);
      const placement = select(languageFields, "Placement", `JEL-${view}-${language}-Placement`, placements, readChoice().placement,
        "Replace swaps the lyric text. Above shows the reading over it. Furigana always sits above kanji.", "Replace");
      const syncPlacement = () => { const attached = readChoice().kind === "furigana"; placement.value = attached ? "attached" : readChoice().placement; for (const option of placement.options) option.disabled = attached ? option.value !== "attached" : option.value === "attached"; placement.disabled = attached; refreshStyles(); };
      listen(kind, "change", () => { apply(() => writeChoice({ kind: kind.value as ReturnType<typeof readChoice>["kind"] }), () => { kind.value = readChoice().kind; }); syncPlacement(); });
      listen(placement, "change", () => { apply(() => writeChoice({ placement: placement.value as "replace" | "above" }), syncPlacement); syncPlacement(); });
      // Registered below after the shared style rows exist; there is no polling
      // watcher and detached controls are still protected by apply().
      placementSyncs.push(syncPlacement);
    }
    const annotationFields = document.createElement("fieldset"); annotationFields.className = "BL-GroupOptions BL-ReadingStyle"; options.append(annotationFields);
    styleRows.set("hint", heading(annotationFields, "Reading style", "p"));
    const readAnnotations = () => PresentationSettings.getAnnotations(view);
    for (const [key, text, minimum, maximum, fallback] of [["secondarySize", "Row size", .25, 1.5, ".6"], ["rubySize", "Ruby size", .25, 1, ".5"], ["gap", "Row gap", 0, 2, ".15 em"], ["spacing", "Letter spacing", -.1, .5, "0 em"], ["opacity", "Opacity", 0, 1, ".8"]] as const) {
      const styleInput = numeric(annotationFields, text, `JEL-${view}-Reading-${key}`, () => readAnnotations()[key],
        value => PresentationSettings.saveAnnotations(view, { ...readAnnotations(), [key]: value }),
        key.endsWith("Size") ? "Size relative to the lyric text." : key === "gap" ? "Space between the reading and the lyric." : key === "spacing" ? "Letter spacing of readings." : "Reading opacity, 0–1.", fallback, minimum, maximum, "0.05");
      styleRows.set(key, styleInput.closest(".BL-HelpRow") as HTMLElement);
    }
    const alignment = select(annotationFields, "Alignment", `JEL-${view}-ReadingAlignment`, [["inherit", "Follow voice"], ["start", "Start"], ["center", "Center"], ["end", "End"]], readAnnotations().alignment,
      "Aligns readings. Follow voice matches the lyric line.", "Follow voice");
    listen(alignment, "change", () => apply(() => PresentationSettings.saveAnnotations(view, { ...readAnnotations(), alignment: alignment.value as "inherit" | "start" | "center" | "end" }), () => { alignment.value = readAnnotations().alignment; }));
    styleRows.set("alignment", alignment.closest(".BL-HelpRow") as HTMLElement);
    placementSyncs.forEach(sync => sync());
    if (presentationReadOnly) heading(fields, "Presentation settings require a newer version.", "p");
  }
  const providers = sectionBlock("Providers");
  for (const name of Providers) {
    const input = toggle(providers, name, "BL-Provider-" + name, GetBehaviorSettings().providers[name], "Uses this source for lyrics.", "On");
    checkbox(input, value => { const current = GetBehaviorSettings(); SaveBehaviorSettings({ ...current, providers: { ...current.providers, [name]: value } }); }, () => GetBehaviorSettings().providers[name]);
  }
  const fonts = sectionBlock("Lyrics Font");
  const family=document.createElement("input");family.id="JEL-FontFamily";family.type="text";family.value=PresentationSettings.getFontFamily();family.placeholder="Spotify font";family.disabled=presentationReadOnly;
  row(fonts,"Font family",family,"Font family for lyrics in both views. It must be installed on this device. Empty uses the Spotify font.","Spotify font");
  listen(family,"change",()=>{
    const next=NormalizeFontFamily(family.value);
    if(next!==family.value.trim()||(next&&!CSS.supports("font-family",next))){family.setAttribute("aria-invalid","true");status.textContent="Enter a valid local font-family list; the previous font is still active.";return;}
    family.removeAttribute("aria-invalid");apply(()=>PresentationSettings.saveFontFamily(next),()=>{family.value=PresentationSettings.getFontFamily()});
  });
  const spicy = sectionBlock("Spicy");
  const token = document.createElement("input"); token.id = "BL-SpicyToken"; token.type = "password"; token.autocomplete = "off"; token.spellcheck = false;
  token.placeholder = "Client token"; token.value = GetSpicyToken();
  row(spicy, "API token", token, "Turns Spicy on. Stored only on this device. Needs the local relay running.", "Empty").classList.add("BL-TokenTile");
  const commitToken = () => apply(() => SetSpicyToken(token.value), () => { token.value = GetSpicyToken(); });
  listen(token, "change", commitToken);
  listen(token, "keydown", event => { if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); commitToken(); } });
  listen(token, "input", () => { status.textContent = "Token applies when editing finishes."; });
  content.append(status);
  (Spotify as any).PopupModal.display({ title: "Just Enough Lyrics Settings", content, isLarge: true });
  disposeTypography=CreateTypographyPreview(content,sizeOutputs,spacingOutputs);
  content.focus({ preventScroll: true });
  const scrollContainer = content.closest(".spicetify-popup-content"); if (scrollContainer) scrollContainer.scrollTop = 0;
}

export const ProviderControlsReady = OnSpotifyReady.then(() => {
  if (GlobalMaid.IsDestroyed()) return;
  // One bounded local probe per extension startup, even in on-demand mode.
  // No polling, upstream request or token transmission. Disposal cancels it.
  if (IsProviderEnabled('Spicy') && GetSpicyToken()) {
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
      if (!GlobalMaid.IsDestroyed() && IsProviderEnabled('Spicy') && GetSpicyToken()) {
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

export function SetupProviderControls(lyricsArea: HTMLElement, maid: Maid) {
  SetupCornerControls(lyricsArea, maid, OpenProviderSettings);
}
