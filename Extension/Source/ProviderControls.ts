import {
  Spotify,
  GlobalMaid,
  OnSpotifyReady,
  ShowNotification,
} from "@Spices/Spicetify/Services/Session.ts";
import {
  GetSpicyToken,
  GetBehaviorSettings,
  SaveProviderSettings,
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
import { CreateSettingsHelp } from "./SettingsHelp.ts";
import "./Stylings/ProviderControls.scss";

export function OpenProviderSettings() {
  const content = document.createElement("form");
  content.className = "BL-Settings";
  const addHelp = CreateSettingsHelp(content);
  const behaviorSection = document.createElement("section");
  content.append(behaviorSection);
  const behavior = GetBehaviorSettings();
  const behaviorTitle = document.createElement("h3");
  behaviorTitle.textContent = "Behavior";
  const fetchLabel = document.createElement("label");
  fetchLabel.textContent = "Fetch lyrics";
  const fetchMode = document.createElement("select");
  fetchMode.id = "BL-FetchMode";
  for (const [value, text] of [
    ["change", "On song change"],
    ["required", "When required"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    fetchMode.append(option);
  }
  fetchMode.value = behavior.fetchMode;
  fetchLabel.append(fetchMode);
  const toggle = (text: string, checked: boolean, id: string, parent: HTMLElement = content) => {
    const label = document.createElement("label");
    label.textContent = text;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = checked;
    input.id = id;
    label.append(input);
    parent.append(label);
    return input;
  };
  behaviorSection.append(behaviorTitle, fetchLabel);
  addHelp(fetchLabel, fetchMode, "When required loads on the lyrics page. An enabled sidebar also loads on song change.", "On song change");
  const sourcesTitle = document.createElement("h4");
  sourcesTitle.textContent = "Enabled providers";
  behaviorSection.append(sourcesTitle);
  const sourceInputs = Object.fromEntries(
    Providers.map((name) => [
      name,
      toggle(name, behavior.providers[name], "BL-Provider-" + name, behaviorSection),
    ]),
  );
  const nowPlayingTitle = document.createElement("h3");
  nowPlayingTitle.textContent = "Now Playing";
  nowPlayingTitle.id = "JEL-NowPlaying-Heading";
  const nowPlayingSection = document.createElement("section");
  nowPlayingSection.className = "BL-ViewSettings";
  nowPlayingSection.setAttribute("aria-labelledby", nowPlayingTitle.id);
  nowPlayingSection.append(nowPlayingTitle);
  content.append(nowPlayingSection);
  const sidebar = toggle("Enabled", behavior.sidebarEnabled, "BL-SidebarEnabled", nowPlayingSection);
  sidebar.setAttribute("aria-label", "Now Playing enabled");
  // These are drafts until Save, just like credentials. Expose only capabilities
  // the current renderer implements; future effects get controls in their pass.
  const languageInputs = new Map<PresentationView, { enabled: HTMLInputElement; languages: Record<string, HTMLInputElement>; japaneseForm: HTMLSelectElement }>();
  const presentationReadOnly = PresentationSettings.isReadOnly();
  const timingInputs = new Map<"Shared" | PresentationView, HTMLInputElement>();
  const timingReadOnly = TimingSettings.isReadOnly();
  const addTiming = (scope: "Shared" | PresentationView, parent: HTMLElement) => {
    const label = document.createElement("label");
    label.textContent = scope === "Shared" ? "Lyric delay (s)" : "Delay offset (s)";
    const offset = document.createElement("input");
    offset.type = "number";
    offset.id = `JEL-${scope}-TimingOffset`;
    offset.min = String(-TimingOffsetLimit);
    offset.max = String(TimingOffsetLimit);
    offset.step = "0.05";
    offset.required = true;
    offset.value = String(TimingSettings.get(scope));
    offset.disabled = timingReadOnly;
    offset.setAttribute("aria-label", scope === "Shared" ? "Shared lyric delay in seconds"
      : `${scope === "NowPlaying" ? "Now Playing" : "Full Lyrics"} delay offset in seconds`);
    label.append(offset);
    parent.append(label);
    const row = addHelp(label, offset, scope === "Shared"
      ? "Both views. Positive = later; negative = earlier. View offsets add to this delay."
      : "This view only, added to the shared delay. Positive = later; negative = earlier.", "0 s");
    timingInputs.set(scope, offset);
    if (timingReadOnly) {
      const note = document.createElement("p");
      note.textContent = "Timing settings were saved by a newer version. Update the extension to edit them.";
      parent.append(note);
    }
    return row;
  };
  const sharedTiming = addTiming("Shared", behaviorSection);
  behaviorSection.insertBefore(sharedTiming, sourcesTitle);
  for (const view of ["NowPlaying", "FullLyrics"] as const) {
    const viewTitle = view === "NowPlaying" ? "Now Playing" : "Full Lyrics";
    const section = view === "NowPlaying" ? nowPlayingSection : document.createElement("section");
    if (view === "FullLyrics") {
      section.className = "BL-ViewSettings";
      const heading = document.createElement("h3");
      heading.textContent = "Full Lyrics";
      heading.id = "JEL-FullLyrics-Heading";
      section.setAttribute("aria-labelledby", heading.id);
      section.append(heading);
      content.append(section);
    }
    addTiming(view, section);
    // Match Comfy's connected subsection card: one switch/header owns its
    // subordinate controls. Hidden controls keep their draft values when Off.
    const group = document.createElement("div");
    group.className = "BL-SettingGroup";
    section.append(group);
    const profile = PresentationSettings.getProfile(view);
    const enabled = toggle("Alternate text", profile.romanizationEnabled, `JEL-${view}-RomanizationEnabled`, group);

    enabled.disabled = presentationReadOnly;
    enabled.setAttribute("aria-label", `${viewTitle} alternate text`);
    const options = document.createElement("fieldset");
    options.className = "BL-GroupOptions";
    options.id = `JEL-${view}-RomanizationOptions`;
    options.setAttribute("aria-label", `${viewTitle} alternate text options`);
    enabled.setAttribute("aria-controls", options.id);
    const updateExpansion = () => {
      options.hidden = !enabled.checked;
      options.disabled = presentationReadOnly || !enabled.checked;
      enabled.setAttribute("aria-expanded", String(enabled.checked));
    };
    enabled.onchange = updateExpansion;
    addHelp(enabled.parentElement as HTMLLabelElement, enabled,
      "Show pinyin, Japanese romaji/kana or romaja. Off shows original text and remembers your choices.", "Off").classList.add("BL-GroupHeader");
    const names = { Chinese: "Chinese (pinyin)", Japanese: "Japanese", Korean: "Korean (romaja)" };
    const inputs = Object.fromEntries(PresentationLanguages.map(language => [language,
      toggle(names[language], profile.romanizedLanguages[language], `JEL-${view}-${language}`, options),
    ]));
    for (const language of PresentationLanguages) {
      inputs[language].setAttribute("aria-label", `${viewTitle} ${language} alternate text`);
      inputs[language].disabled = presentationReadOnly;
    }
    const japaneseLabel = document.createElement("label");
    japaneseLabel.textContent = "Japanese text";
    const japaneseForm = document.createElement("select");
    japaneseForm.id = `JEL-${view}-JapaneseForm`;
    japaneseForm.disabled = presentationReadOnly;
    for (const [value, text] of [["romaji", "Romaji"], ["kana", "Kana"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; japaneseForm.append(option);
    }
    japaneseForm.value = profile.japaneseForm;
    japaneseForm.setAttribute("aria-label", `${viewTitle} Japanese text form`);
    japaneseLabel.append(japaneseForm);
    options.append(japaneseLabel);
    addHelp(japaneseLabel, japaneseForm, "Primary text when Japanese is selected. Kana uses contextual readings; Original is shown while loading or if unavailable.", "Romaji");
    languageInputs.set(view, { enabled, languages: inputs, japaneseForm });
    group.append(options);
    updateExpansion();
    if (presentationReadOnly) {
      const note = document.createElement("p");
      note.textContent = "Presentation settings were saved by a newer version. Update the extension to edit them. Provider settings remain available.";
      section.append(note);
    }
  }
  const title = document.createElement("h3");
  title.textContent = "Spicy";
  const label = document.createElement("label");
  label.textContent = "API token";
  label.htmlFor = "BL-SpicyToken";
  const input = document.createElement("input");
  input.id = "BL-SpicyToken";
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Paste your client token";
  input.value = GetSpicyToken();
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";
  label.append(input);
  content.append(title, label, save, status);
  addHelp(label, input,
    "Client key (sl_pk_…). Allow requests without Origin. Run node spicy-proxy.mjs start locally; stop/status manage the relay. Key stays on this device.",
    "Empty (disabled)").classList.add("BL-TokenTile");
  content.onsubmit = (event) => {
    event.preventDefault();
    try {
      for (const [view, inputs] of languageInputs) {
        if (presentationReadOnly) continue;
        PresentationSettings.saveProfile(view, {
          romanizationEnabled: inputs.enabled.checked,
          japaneseForm: inputs.japaneseForm.value as "romaji" | "kana",
          romanizedLanguages: Object.fromEntries(
            PresentationLanguages.map(language => [language, inputs.languages[language].checked]),
          ) as ReturnType<typeof PresentationSettings.getProfile>["romanizedLanguages"],
        });
      }
      if (!timingReadOnly) {
        TimingSettings.save(Object.fromEntries([...timingInputs].map(([scope, input]) =>
          [scope, Number(input.value)])) as Record<"Shared" | PresentationView, number>);
      }
      SaveProviderSettings(input.value, {
        fetchMode: fetchMode.value as "change" | "required",
        sidebarEnabled: sidebar.checked,
        providers: Object.fromEntries(
          Providers.map((name) => [name, sourceInputs[name].checked]),
        ) as typeof behavior.providers,
      });
      input.value = GetSpicyToken();
      status.textContent = "Settings saved.";
    } catch {
      status.textContent = "Could not save settings on this device.";
    }
  };
  (Spotify as any).PopupModal.display({
    title: "Just Enough Lyrics Settings",
    content,
    isLarge: true,
  });
  // The host otherwise focuses the password field and scrolls past the first
  // sections. Start at Behavior while keeping keyboard navigation available.
  fetchMode.focus({ preventScroll: true });
  const scrollContainer = content.closest(".spicetify-popup-content");
  if (scrollContainer) scrollContainer.scrollTop = 0;
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
