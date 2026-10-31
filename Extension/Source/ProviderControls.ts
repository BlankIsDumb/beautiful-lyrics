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
import { TimingSettings, TimingOffsetLimit } from "./TimingSettings.ts";
import { ApplyTextPreset, NormalizeRendering, SourceCases, type RenderingProfile } from "./RenderingSettings.ts";
import { CreateSettingsHelp } from "./SettingsHelp.ts";
import "./Stylings/ProviderControls.scss";

export function OpenProviderSettings() {
  const content = document.createElement("form");
  content.className = "BL-Settings";
  const lifetime = new AbortController();
  const addHelp = CreateSettingsHelp(content, () => {
    lifetime.abort();
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
  const lyricsSection = document.createElement("section"); content.append(lyricsSection); heading(lyricsSection, "Lyrics");
  for (const view of ["NowPlaying", "FullLyrics"] as const) {
    const viewTitle = view === "NowPlaying" ? "Now Playing" : "Fullscreen";
    const section = document.createElement("section"); section.className = "BL-ViewSettings"; lyricsSection.append(section);
    const title = heading(section, viewTitle, "h4"); title.id = `JEL-${view}-Heading`; section.setAttribute("aria-labelledby", title.id);
    let sidebar: HTMLInputElement | undefined;
    if (view === "NowPlaying") sidebar = toggle(section, "Enabled", "BL-SidebarEnabled", GetBehaviorSettings().sidebarEnabled, "Show lyrics in Now Playing. Off keeps your settings and collapses all options below.", "On");
    const fields = document.createElement("fieldset"); fields.className = "BL-ViewOptions"; fields.id = `JEL-${view}-Options`; section.append(fields);
    if (sidebar) {
      sidebar.setAttribute("aria-label", "Now Playing enabled"); sidebar.setAttribute("aria-controls", fields.id);
      const expansion = () => { fields.hidden = !sidebar!.checked; fields.disabled = !sidebar!.checked; sidebar!.setAttribute("aria-expanded", String(sidebar!.checked)); };
      checkbox(sidebar, value => SaveBehaviorSettings({ ...GetBehaviorSettings(), sidebarEnabled: value }), () => GetBehaviorSettings().sidebarEnabled, expansion); expansion();
    }
    const delay = addTiming(view, fields); delay.setAttribute("aria-label", `${viewTitle} delay offset in seconds`);
    if (view === "FullLyrics") delay.setAttribute("aria-description", "Fullscreen, cinema and lyrics page share this viewer.");
    const gap = numeric(fields, "Gap dots after (s)", `JEL-${view}-GapThreshold`, () => PresentationSettings.getCues(view).threshold,
      value => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), threshold: value }),
      "Minimum real silence across all voices. 0 disables dots; 100 means 100 seconds. Very short gaps use static dots.", "2 s", 0, undefined, "0.1", presentationReadOnly);
    gap.setAttribute("aria-label", `${viewTitle} gap dots threshold in seconds`);
    const cueMotion = toggle(fields, "Dot motion", `JEL-${view}-CueMotion`, PresentationSettings.getCues(view).motion,
      "Animated or static gap dots for this view, shared by Word and Line sources. Text presets never change this.", "On"); cueMotion.disabled = presentationReadOnly;
    checkbox(cueMotion, motion => PresentationSettings.saveCues(view, { ...PresentationSettings.getCues(view), motion }), () => PresentationSettings.getCues(view).motion);
    const readingGroups: HTMLDetailsElement[] = [];
    for (const sourceCase of SourceCases) {
      const details = document.createElement("details"); details.className = "BL-CaseSettings"; details.id = `JEL-${view}-${sourceCase}-Settings`;
      const summary = document.createElement("summary"); summary.textContent = `${sourceCase} sync`; details.append(summary); fields.append(details);
      const body = document.createElement("fieldset"); body.className = "BL-GroupOptions"; body.disabled = presentationReadOnly; details.append(body);
      const read = () => PresentationSettings.getRendering(view, sourceCase);
      const prefix = `JEL-${view}-${sourceCase}-`;
      const preset = select(body, "Text preset", prefix + "TextPreset", [["classic", "Classic"], ["minimal", "Minimal"], ["balanced", "Balanced"], ["custom", "Custom"]], read().preset,
        "Editable text effects only. Gap dots and background are separate. The source timing selects this case, even if Word text is displayed as Line.", "Classic");
      preset.setAttribute("aria-label", `${viewTitle} ${sourceCase} text preset`);
      const effectInputs = new Map<keyof RenderingProfile, HTMLInputElement>();
      const detail = sourceCase === "Word" ? select(body, "Text detail", prefix + "TextDetail", [["auto", "Auto"], ["line", "Line"], ["word", "Word"]], read().detail,
        "Display this word-timed source as words or a whole line. This remains the Word-source case.", "Auto") : undefined;
      const highlight = select(body, "Highlight", prefix + "TextHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], read().highlight,
        "Whole segment changes at its start. Progressive follows available timing and freezes in gaps. Off keeps solid text.", "Classic");
      highlight.setAttribute("aria-label", `${viewTitle} ${sourceCase} highlight`);
      if (detail) detail.setAttribute("aria-label", `${viewTitle} Word text detail`);
      for (const [key, text, help] of [
        ["scale", "Scale", "Scale movement; whole-line detail uses its existing active scale."],
        ["verticalMotion", "Vertical motion", "Word display detail only; whole-line detail stays on its baseline."],
        ["glow", "Glow", "Animated text glow, independent of inactive blur."],
        ["blur", "Inactive blur", "Blur vocals away from active voices."],
        ["emphasis", "Letter emphasis", "Safe short runs in Word display detail, when another continuous effect is enabled."],
      ] as const) {
        if (sourceCase === "Line" && (key === "verticalMotion" || key === "emphasis")) continue;
        const input = toggle(body, text, prefix + key, read()[key], help, "On"); effectInputs.set(key, input);
        input.setAttribute("aria-label", `${viewTitle} ${sourceCase} ${text.toLowerCase()}`);
        checkbox(input, value => PresentationSettings.saveRendering(view, sourceCase, { ...read(), [key]: value, preset: "custom" }), () => read()[key]);
      }
      const sync = () => { const current = read(); preset.value = current.preset; highlight.value = current.highlight; if (detail) detail.value = current.detail; for (const [key, input] of effectInputs) input.checked = current[key] as boolean; };
      listen(preset, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, preset.value === "custom" ? { ...read(), preset: "custom" } : ApplyTextPreset(read(), preset.value as "classic" | "minimal" | "balanced")), sync); sync(); });
      listen(highlight, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, { ...read(), highlight: highlight.value as RenderingProfile["highlight"], preset: "custom" }), sync); sync(); });
      for (const input of effectInputs.values()) listen(input, "change", sync);
      if (detail) listen(detail, "change", () => { apply(() => PresentationSettings.saveRendering(view, sourceCase, { ...read(), detail: detail.value as RenderingProfile["detail"] }), sync); sync(); });
      const readingGroup = document.createElement("details"); readingGroup.className = "BL-CaseSettings";
      const readingTitle = document.createElement("summary"); readingGroups.push(readingGroup);
      readingTitle.textContent = "Reading effects"; readingGroup.append(readingTitle); body.append(readingGroup);
      const readingFields = document.createElement("fieldset"); readingFields.className = "BL-GroupOptions"; readingGroup.append(readingFields);
      const readAnnotations = () => PresentationSettings.getAnnotations(view);
      const readCase = () => readAnnotations().cases[sourceCase];
      const writeCase = (value: ReturnType<typeof readCase>) => {
        const current = readAnnotations(); PresentationSettings.saveAnnotations(view, { ...current, cases: { ...current.cases, [sourceCase]: value } });
      };
      const inherit = toggle(readingFields, "Use text effects", prefix + "ReadingInherit", readCase().inherit,
        "Secondary text and ruby use this source case's text effects. Off enables independent reading effects below. Readings use grouped source timing, never invented phoneme timing.", "On");
      const custom = document.createElement("fieldset"); custom.className = "BL-GroupOptions"; readingFields.append(custom);
      const readingExpand = () => { custom.hidden = inherit.checked; custom.disabled = inherit.checked; };
      checkbox(inherit, value => writeCase({ ...readCase(), inherit: value }), () => readCase().inherit, readingExpand); readingExpand();
      const readingHighlight = select(custom, "Highlight", prefix + "ReadingHighlight", [["classic", "Classic"], ["off", "Off"], ["segment", "Whole segment"], ["progressive", "Progressive"]], readCase().effects.highlight,
        "Reading highlight for this source case only. Grouped progress freezes in real source gaps.", "Use text effects");
      listen(readingHighlight, "change", () => apply(() => writeCase({ ...readCase(), effects: { ...readCase().effects, highlight: readingHighlight.value as RenderingProfile["highlight"], preset: "custom" } }), () => { readingHighlight.value = readCase().effects.highlight; }));
      for (const [key, text] of [["scale", "Scale"], ["verticalMotion", "Vertical motion"], ["glow", "Glow"], ["blur", "Inactive blur"]] as const) {
        if (sourceCase === "Line" && key === "verticalMotion") continue;
        const input = toggle(custom, text, prefix + "Reading-" + key, readCase().effects[key],
          "Independent reading effect for this source case. Whole-line detail has no vertical motion. Off stops its effect work.", "Use text effects");
        checkbox(input, value => writeCase({ ...readCase(), effects: { ...readCase().effects, [key]: value, preset: "custom" } }), () => readCase().effects[key]);
      }
      if (sourceCase === "Word") {
        const emphasis = toggle(custom, "Letter emphasis", prefix + "Reading-emphasis", readCase().effects.emphasis,
          "Visual grapheme easing over the original source progress, where shaping and mapping are safe. This is not measured phoneme timing. Off allocates no reading letters.", "Use text effects");
        checkbox(emphasis, value => writeCase({ ...readCase(), effects: { ...readCase().effects, emphasis: value, preset: "custom" } }), () => readCase().effects.emphasis);
      }
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
      option.textContent =
        option.value +
        (lyrics.Source?.HasWordSync
          ? " (word sync)"
          : lyrics.Type === "Static"
            ? " (plain text)"
            : "");
      option.selected = option.value === SongLyrics?.Source?.Provider;
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
