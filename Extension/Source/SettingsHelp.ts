import { Spotify, GlobalMaid } from "@Spices/Spicetify/Services/Session.ts";

export const LyricsCacheHelp = "Clear saved lyrics for one provider or All. Spicy uses disk storage, with 14-day lyric hits and 1-day not-found results. All also clears track details, prepared lyrics and provider cooldowns. Credentials stay saved. The current song reloads afterwards. Counts refresh when Settings opens and after clearing.";

export const BackgroundHelp = {
  mode: "Animated moves the artwork gradient. Static draws only when artwork or dimensions change. Off releases all background resources. Full Lyrics pages share one profile; Now Playing styles only the lyrics card.",
  motion: "Gradient motion speed: Slow is 0.5 times, Classic is 1 times, Fast is 2 times the original speed. Available only in Animated mode.",
  brightness: "50–150% in steps of 5, multiplying this surface's original brightness. Applies immediately without redrawing the shader.",
  paused: "Freeze stops background animation while playback is paused, preserving its position. Animate keeps moving, as the original background did.",
  fps: "Maximum animation draws per second. Uncapped follows the display refresh rate. Classic background preserves this quality choice.",
  resolution: "Drawing resolution relative to device pixel ratio: Full, Half or Quarter. Lower values reduce rendering work. Classic background preserves this quality choice.",
};

let disposeActiveHelp: (() => void) | undefined;
let nextHelpId = 0;
GlobalMaid.Give(() => disposeActiveHelp?.());

// PopupModal has no onClose: its host removes/replaces DOM on both hide/display.
// A disconnected custom-element child owns precisely this form's tooltips, with
// no app-wide observer, interval, or patched host methods. The tag survives reloads;
// callbacks live on each element so a previous runtime's class owns no new state.
const lifetimeTag = "jel-settings-help-lifetime";
type LifetimeElement = HTMLElement & { disposeHelp?: () => void };
if (!customElements.get(lifetimeTag)) {
  customElements.define(lifetimeTag, class extends HTMLElement {
    disconnectedCallback() { (this as LifetimeElement).disposeHelp?.(); }
  });
}

export function CreateSettingsHelp(form: HTMLFormElement, onDispose?: () => void) {
  disposeActiveHelp?.();
  const resources: (() => void)[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    onDispose?.(); // Abort every immediate form handler before focus/tooltip cleanup.
    for (const destroy of resources) destroy();
    resources.length = 0;
    if (disposeActiveHelp === dispose) disposeActiveHelp = undefined;
    // Extension disposal can leave this form connected. Block native submission
    // as well as stale application writes; clearing onsubmit would navigate.
    form.onsubmit = event => event.preventDefault();
    const save = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (save) save.disabled = true;
  };
  disposeActiveHelp = dispose;
  const lifetime = document.createElement(lifetimeTag) as LifetimeElement;
  lifetime.hidden = true;
  lifetime.disposeHelp = dispose;
  form.append(lifetime);

  return (label: HTMLLabelElement, control: HTMLElement, explanation: string, classic?: string) => {
    const row = document.createElement("div");
    row.className = "BL-HelpRow";
    // A real sibling button is a separate control. Clicking/focusing help must
    // never activate a wrapping label's checkbox or redirect focus to its input.
    label.replaceWith(row);
    label.htmlFor = control.id;
    control.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "BL-HelpButton";
    button.setAttribute("aria-label", `${control.getAttribute("aria-label") || label.firstChild?.textContent || "Setting"} help`);
    button.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path d="M7.25 12.026v-1.5h1.5v1.5h-1.5zm.884-7.096A1.125 1.125 0 0 0 7.06 6.39l-1.431.448a2.625 2.625 0 1 1 5.13-.784c0 .54-.156 1.015-.503 1.488-.3.408-.7.652-.973.818l-.112.068c-.185.116-.26.203-.302.283-.046.087-.097.245-.097.57h-1.5c0-.47.072-.898.274-1.277.206-.385.507-.645.827-.846l.147-.092c.285-.177.413-.257.526-.41.169-.23.213-.397.213-.602 0-.622-.503-1.125-1.125-1.125z"/></svg>';
    const description = document.createElement("span");
    description.className = "BL-HelpDescription";
    description.id = `JEL-SettingHelp-${++nextHelpId}`;
    description.textContent = explanation + (classic ? ` Classic: ${classic}` : "");
    button.setAttribute("aria-describedby", description.id);
    control.setAttribute("aria-describedby", description.id);
    row.append(label, button, control, description);
    const popup = (Spotify as any).Tippy(button, {
      trigger: "mouseenter focus click",
      placement: "left",
      delay: 0,
      animation: false,
      hideOnClick: true,
      aria: { content: null, expanded: false },
      appendTo: () => document.fullscreenElement || document.body,
      render() {
        const popper = document.createElement("div");
        popper.className = "BL-SettingsHelpPopup";
        popper.setAttribute("role", "tooltip");
        const text = document.createElement("div");
        text.textContent = explanation;
        popper.append(text);
        if (classic) {
          const footer = document.createElement("div");
          footer.className = "BL-HelpClassic";
          footer.textContent = `Classic: ${classic}`;
          popper.append(footer);
        }
        return { popper };
      },
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && popup.state.isVisible) { popup.hide(); event.stopPropagation(); }
    };
    button.addEventListener("keydown", onKey);
    resources.push(() => { popup.destroy(); button.removeEventListener("keydown", onKey); });
    return row;
  };
}
