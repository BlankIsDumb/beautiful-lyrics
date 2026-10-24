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
import "./Stylings/ProviderControls.scss";

export function OpenProviderSettings() {
  const content = document.createElement("form");
  content.className = "BL-Settings";
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
  const toggle = (text: string, checked: boolean, id: string) => {
    const label = document.createElement("label");
    label.textContent = text;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.id = id;
    label.append(input);
    content.append(label);
    return input;
  };
  content.append(behaviorTitle, fetchLabel);
  const sidebar = toggle(
    "Now Playing sidebar lyrics",
    behavior.sidebarEnabled,
    "BL-SidebarEnabled",
  );
  const note = document.createElement("p");
  note.textContent =
    "When required fetches when the Beautiful Lyrics page is open. Lyrics still fetch on song change if Now Playing sidebar lyrics is enabled. Sidebar display depends on client/theme compatibility.";
  content.append(note);
  const sourcesTitle = document.createElement("h4");
  sourcesTitle.textContent = "Enabled providers";
  content.append(sourcesTitle);
  const sourceInputs = Object.fromEntries(
    Providers.map((name) => [
      name,
      toggle(name, behavior.providers[name], "BL-Provider-" + name),
    ]),
  );
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
  const description = document.createElement("p");
  description.textContent =
    "Use your client key (sl_pk_…) with requests without an Origin header allowed in Spicy’s API settings. Run node spicy-proxy.mjs start on this device. Use stop or status to manage it. The local relay sends requests directly to Spicy, without Origin. Leave empty to disable. The key is stored only on this device.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";
  content.append(title, label, input, description, save, status);
  content.onsubmit = (event) => {
    event.preventDefault();
    try {
      SaveProviderSettings(input.value, {
        fetchMode: fetchMode.value as "change" | "required",
        sidebarEnabled: sidebar.checked,
        providers: Object.fromEntries(
          Providers.map((name) => [name, sourceInputs[name].checked]),
        ) as typeof behavior.providers,
      });
      input.value = GetSpicyToken();
      status.textContent =
        input.value && sourceInputs.Spicy.checked
          ? "Saved. Spicy is enabled."
          : "Saved. Spicy is disabled.";
    } catch {
      status.textContent = "Could not save settings on this device.";
    }
  };
  (Spotify as any).PopupModal.display({
    title: "Beautiful Lyrics Settings",
    content,
    isLarge: false,
  });
}

OnSpotifyReady.then(() => {
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
        ShowNotification('Beautiful Lyrics: Spicy relay is unavailable. Run node spicy-proxy.mjs start to use Spicy.', 'warning', 8);
      }
    }).finally(() => clearTimeout(timeout));
  }
  // Use Spicetify's right-side registration, exactly as Comfy does. The host
  // handles nav remounts; no additional DOM observer or polling loop is needed.
  const button = new (Spotify as any).Topbar.Button(
    "Beautiful Lyrics Settings",
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
