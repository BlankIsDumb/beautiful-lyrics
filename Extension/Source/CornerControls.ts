import { Spotify } from "@Spices/Spicetify/Services/Session.ts";
import { SongLyrics, SongLyricChoices, SongChanged, SongLyricsLoaded, SelectLyricsProvider, CanClearSongLyricsCache, ClearSongLyricsCache } from "@Spices/Spicetify/Services/Player/mod.ts";
import type { Maid } from "@Universal/Modules/Maid.ts";
import { PresentationSettings } from "./PresentationSettings.ts";
import { TimingSettings } from "./TimingSettings.ts";
import { BuildProviderCredit, BuildProviderCreditDOM } from "./ProviderCredit.ts";
import { SaveTimingOffset, SaveLayoutField, SaveBackgroundField, TimingOffsetInput, PrimarySizeInput } from "./ViewSettingsControls.ts";

// A view transition can briefly leave two surfaces mounted. Coordinate their
// menus too, without retaining a disposed view or adding a global event loop.
let closeActiveMenu: (() => void) | undefined;
let nextMenuId = 0;

export function StepControlValue(value: number, direction: number, bounds: {min: number; max: number; step: string}) {
  const precision = bounds.step.split(".")[1]?.length ?? 0;
  return Math.max(bounds.min, Math.min(bounds.max, Number((value + direction * Number(bounds.step)).toFixed(precision))));
}

export function SetupCornerControls(lyricsArea: HTMLElement, maid: Maid, openAllSettings: () => void) {
  const lifetime = new AbortController();
  const controls = document.createElement("div");
  controls.className = "BL-CornerControls";
  const creditElement = document.createElement("div"); creditElement.className = "BL-CornerCredit";
  controls.append(creditElement);
  lyricsArea.append(controls);
  const listen = (element: EventTarget, type: string, callback: EventListener) =>
    element.addEventListener(type, callback, {signal: lifetime.signal});
  const makeMenu = (title: string, icon: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>`;
    const panel = document.createElement("div");
    panel.className = "BL-CornerMenu";
    panel.id = `JEL-CornerMenu-${++nextMenuId}`;
    panel.setAttribute("popover", "manual");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);
    button.setAttribute("aria-controls", panel.id);
    const heading = document.createElement("h3"); heading.textContent = title;
    panel.append(heading);
    // Keeping each panel after its trigger preserves native tab order, even
    // though the browser paints the open popover in the top layer.
    controls.append(button, panel);
    const tooltip = Spotify.Tippy(button, {...Spotify.TippyProps, content: title,
      appendTo: () => document.fullscreenElement || document.body});
    maid.Give(() => tooltip.destroy());
    return {button, panel, tooltip};
  };
  const provider = makeMenu("Lyrics provider", '<path d="M4 5h16M4 10h16M4 15h10M4 20h10"/><path d="m17 17 2 2 3-4"/>');
  const quick = makeMenu("Quick settings", '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6M16 9v6M10 15v6"/>');
  let active: typeof provider | undefined;
  let openLifetime: AbortController | undefined;
  let resize: ResizeObserver | undefined;
  const close = (restoreFocus = false) => {
    if (!active) return;
    const previous = active; active = undefined;
    openLifetime?.abort(); resize?.disconnect();
    // Owners may remove the view's root before cleaning its child resources.
    // A detached popover is already hidden by the browser.
    if (previous.panel.matches(":popover-open")) previous.panel.hidePopover();
    previous.button.setAttribute("aria-expanded", "false");
    previous.button.after(previous.panel);
    if (closeActiveMenu === close) closeActiveMenu = undefined;
    if (restoreFocus) previous.button.focus();
  };
  const position = () => {
    if (!active) return;
    const anchor = active.button.getBoundingClientRect(), row = controls.getBoundingClientRect();
    const panel = active.panel, box = panel.getBoundingClientRect();
    const edge = 8, width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    panel.style.left = `${Math.max(edge, Math.min(row.right - box.width, width - box.width - edge))}px`;
    panel.style.top = `${Math.max(edge, Math.min(anchor.top - box.height - edge, height - box.height - edge))}px`;
  };
  const placeInFullscreen = () => {
    if (!active) return;
    const panel = active.panel, fullscreen = document.fullscreenElement;
    // Usually fullscreen owns the whole document. Handle a narrower fullscreen
    // element as well; top-layer content must still be its DOM descendant.
    if (fullscreen && !fullscreen.contains(panel)) fullscreen.append(panel);
    else if (!fullscreen && panel.parentElement !== controls) active.button.after(panel);
  };
  const open = (menu: typeof provider) => {
    if (lifetime.signal.aborted) return;
    if (active === menu) { close(); return; }
    closeActiveMenu?.(); active = menu; closeActiveMenu = close;
    if (menu === quick) syncQuick();
    else { if (clearPhase === "idle") clearStatus.textContent = ""; updateProviders(); }
    placeInFullscreen(); menu.panel.showPopover(); position();
    menu.button.setAttribute("aria-expanded", "true");
    menu.tooltip.hide();
    openLifetime = new AbortController();
    const options = {signal: openLifetime.signal};
    document.addEventListener("click", event => {
      const target = event.target as Node;
      if (!controls.contains(target) && !menu.panel.contains(target)) close();
    }, {...options, capture: true});
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    }, {...options, capture: true});
    window.addEventListener("resize", position, options);
    document.addEventListener("scroll", event => {
      // Lyric auto-scrolling cannot move the corner anchor. Only ancestor
      // scrolling needs geometry reads, not every animation-driven scroll.
      if (event.target instanceof Node && event.target.contains(controls)) position();
    }, {...options, capture: true, passive: true});
    resize = new ResizeObserver(position); resize.observe(lyricsArea);
    menu.panel.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
  };
  listen(provider.button, "click", () => open(provider));
  listen(quick.button, "click", () => open(quick));
  listen(document, "fullscreenchange", () => {
    if (!active) return;
    // Re-promote a menu opened before fullscreen, which also enters the top layer.
    if (active.panel.matches(":popover-open")) active.panel.hidePopover();
    placeInFullscreen(); active.panel.showPopover(); position();
  });

  const providerList = document.createElement("div"); provider.panel.append(providerList);
  const providerRows = new Map<string, HTMLButtonElement>();
  const empty = document.createElement("button"); empty.type = "button"; empty.disabled = true;
  empty.className = "BL-ProviderChoice"; empty.textContent = "No lyrics for this song";
  const providerDivider = document.createElement("div"); providerDivider.className = "BL-MenuDivider"; providerDivider.setAttribute("role", "separator");
  // Never natively disabled: focus must stay on the button through the flow.
  const clearSong = document.createElement("button"); clearSong.type = "button"; clearSong.className = "BL-ClearSong"; clearSong.textContent = "Clear this song's cache";
  const clearStatus = document.createElement("p"); clearStatus.setAttribute("role", "status");
  provider.panel.append(providerDivider, clearSong, clearStatus);
  let clearPhase: "idle" | "clearing" | "loading" = "idle";
  const syncClearSong = () => clearSong.setAttribute("aria-disabled", String(clearPhase !== "idle" || !CanClearSongLyricsCache()));
  const setClearPhase = (phase: typeof clearPhase) => { clearPhase = phase; syncClearSong(); };
  listen(clearSong, "click", () => {
    if (clearSong.getAttribute("aria-disabled") === "true") return;
    setClearPhase("clearing"); clearStatus.textContent = ""; position();
    const settle = (ok: boolean) => {
      if (lifetime.signal.aborted) return;
      setClearPhase(ok ? "loading" : "idle");
      clearStatus.textContent = ok ? "Cache cleared. Fetching again." : "Could not clear the cache on this device.";
      position();
    };
    ClearSongLyricsCache().then(result => settle(!result.failed), () => settle(false));
  });
  const updateProviders = () => {
    syncClearSong();
    const credit = BuildProviderCredit(SongLyrics);
    creditElement.hidden = !credit;
    creditElement.replaceChildren(...(credit ? [BuildProviderCreditDOM(credit)] : []));
    const current = SongLyrics?.Source?.Provider;
    const title = current ? `Lyrics provider: ${current}` : "Lyrics provider";
    provider.button.setAttribute("aria-label", title); provider.tooltip.setContent(title);
    const names = new Set<string>(SongLyricChoices.map(lyrics => lyrics.Source!.Provider));
    for (const [name, row] of providerRows) if (!names.has(name)) { row.remove(); providerRows.delete(name); }
    if (!names.size) { providerList.append(empty); return; }
    empty.remove();
    SongLyricChoices.forEach((lyrics, index) => {
      const name = lyrics.Source!.Provider, selected = name === current;
      const effective = selected ? SongLyrics! : lyrics;
      let row = providerRows.get(name);
      if (!row) {
        row = document.createElement("button"); row.type = "button"; row.className = "BL-ProviderChoice"; row.dataset.provider = name;
        for (const className of ["BL-ProviderCheck", "BL-ProviderName", "BL-SyncTag"]) {
          const span = document.createElement("span"); span.className = className; row.append(span);
        }
        row.children[0].setAttribute("aria-hidden", "true"); providerRows.set(name, row);
      }
      row.setAttribute("aria-pressed", String(selected));
      row.children[0].textContent = selected ? "\u2713" : "";
      row.children[1].textContent = name;
      row.children[2].textContent = effective.Source?.HasWordSync ? "Word" : effective.Type === "Static" ? "Plain" : "Line";
      // Leave stable rows in place so provider refreshes preserve keyboard focus.
      if (providerList.children[index] !== row) providerList.insertBefore(row, providerList.children[index] ?? null);
    });
  };
  listen(providerList, "click", event => {
    const row = (event.target as Element).closest<HTMLButtonElement>("button[data-provider]");
    if (!row || row.disabled) return;
    SelectLyricsProvider(row.dataset.provider!);
    updateProviders(); position();
  });

  const status = document.createElement("p"); status.setAttribute("role", "status");
  const apply = (write: () => void) => {
    try { write(); status.textContent = ""; }
    catch { status.textContent = "Could not apply settings on this device."; }
    syncQuick(); position();
  };
  const row = (text: string, control: HTMLElement, tag: "label" | "div" = "label") => {
    const label = document.createElement(tag); label.className = "BL-QuickRow";
    const name = document.createElement("span"); name.textContent = text;
    label.append(name, control); quick.panel.append(label); return label;
  };
  const stepper = (text: string, read: () => number, write: (value: number) => void,
    bounds: {min: number; max: number; step: string}, readOnly: () => boolean) => {
    // A group rather than a label: the two buttons have separate accessible
    // names and neither should receive accidental native label activation.
    const group = document.createElement("div"); group.className = "BL-Stepper";
    group.setAttribute("role", "group"); group.setAttribute("aria-label", text);
    const minus = document.createElement("button"), plus = document.createElement("button"), value = document.createElement("output");
    for (const [button, direction] of [[minus, -1], [plus, 1]] as const) {
      button.type = "button"; button.textContent = direction === -1 ? "\u2212" : "+";
      button.setAttribute("aria-label", `${direction === -1 ? "Decrease" : "Increase"} ${text.toLowerCase()}`);
      listen(button, "click", () => { if (!readOnly()) apply(() => write(StepControlValue(read(), direction, bounds))); });
    }
    value.setAttribute("aria-label", text); value.setAttribute("aria-live", "polite");
    group.append(minus, value, plus);
    const wrapper = row(text, group, "div");
    return () => {
      const current = read(); value.value = String(Number(current.toFixed(bounds.step.split(".")[1]?.length ?? 0)));
      minus.disabled = readOnly() || current <= bounds.min; plus.disabled = readOnly() || current >= bounds.max;
      wrapper.setAttribute("aria-disabled", String(readOnly()));
    };
  };
  const syncOffset = stepper("Offset (s)", () => TimingSettings.get("FullLyrics"), value => SaveTimingOffset("FullLyrics", value), TimingOffsetInput, TimingSettings.isReadOnly);
  const syncSize = stepper("Text size", () => PresentationSettings.getLayout("FullLyrics").primaryRatio,
    value => SaveLayoutField("FullLyrics", "primaryRatio", value), PrimarySizeInput, PresentationSettings.isReadOnly);
  const toggle = (text: string) => {
    const input = document.createElement("input"); input.type = "checkbox";
    input.setAttribute("role", "switch"); input.setAttribute("aria-label", text); row(text, input); return input;
  };
  const conversions = toggle("Conversions"), follow = toggle("Auto-follow");
  listen(conversions, "change", () => {
    const language = SongLyrics?.RomanizedLanguage;
    if (!conversions.disabled && language) apply(() => PresentationSettings.setRomanized("FullLyrics", language, conversions.checked));
  });
  listen(follow, "change", () => { if (!follow.disabled) apply(() => SaveLayoutField("FullLyrics", "follow", follow.checked)); });
  const background = document.createElement("select"); background.setAttribute("aria-label", "Background");
  for (const [value, text] of [["animated", "Animated"], ["static", "Static"], ["off", "Off"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; background.append(option);
  }
  row("Background", background);
  listen(background, "change", () => { if (!background.disabled) apply(() => SaveBackgroundField("FullLyrics", "mode", background.value as "animated" | "static" | "off")); });
  const all = document.createElement("button"); all.type = "button"; all.className = "BL-AllSettings"; all.textContent = "All settings";
  // The divider spans the menu's inner width independently of themed button
  // corners. A border on All settings would curve with the button itself.
  const divider = document.createElement("div"); divider.className = "BL-MenuDivider"; divider.setAttribute("role", "separator");
  quick.panel.append(divider, all, status);
  listen(all, "click", () => {
    close();
    // Exiting can destroy a fullscreen-only view. Opening the modal is still
    // intentional after that teardown; it must wait for fullscreen to finish.
    void (async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); openAllSettings(); }
      catch { if (!lifetime.signal.aborted) { open(quick); status.textContent = "Could not open settings on this device."; position(); } }
    })();
  });
  const syncQuick = () => {
    syncOffset(); syncSize();
    const readOnly = PresentationSettings.isReadOnly(), language = SongLyrics?.RomanizedLanguage;
    const setDisabled = (control: HTMLInputElement | HTMLSelectElement, disabled: boolean) => {
      control.disabled = disabled;
      control.parentElement!.classList.toggle("BL-QuickDisabled", disabled);
    };
    setDisabled(conversions, readOnly || !language);
    conversions.checked = !!language && PresentationSettings.isRomanized("FullLyrics", language);
    setDisabled(follow, readOnly || SongLyrics?.Type === "Static");
    follow.checked = PresentationSettings.getLayout("FullLyrics").follow;
    setDisabled(background, readOnly); background.value = PresentationSettings.getBackground("FullLyrics").mode;
  };
  const changed = () => { updateProviders(); if (active === quick) syncQuick(); position(); };
  // Signals during clearing belong to the old lookup; only loading ends here.
  const finishLoading = () => { if (clearPhase === "loading") setClearPhase("idle"); };
  maid.Give(SongChanged.Connect(() => { finishLoading(); clearStatus.textContent = ""; changed(); }));
  maid.Give(SongLyricsLoaded.Connect(() => { finishLoading(); changed(); }));
  maid.Give(TimingSettings.subscribe(scopes => { if (active === quick && scopes.includes("FullLyrics")) syncQuick(); }));
  const presentationChanged = (view: string) => { if (view === "FullLyrics" && active === quick) syncQuick(); };
  maid.Give(PresentationSettings.subscribe(presentationChanged));
  maid.Give(PresentationSettings.subscribeLayout(presentationChanged));
  maid.Give(PresentationSettings.subscribeBackground(presentationChanged));
  maid.Give(() => { close(); lifetime.abort(); controls.remove(); });
  updateProviders();
}
