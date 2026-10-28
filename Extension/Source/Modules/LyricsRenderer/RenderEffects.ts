import Spring from "@Universal/Modules/LegacySpring.ts";
import type { RenderingCounters, RenderingProfile } from "../../RenderingSettings.ts";

export type TextSprings = { Scale?: Spring; YOffset?: Spring; Glow?: Spring };
export type SpringParameters = { scale: readonly [number, number]; vertical: readonly [number, number]; glow: readonly [number, number] };
export type VocalRenderOptions = { root?: HTMLDivElement; profile?: RenderingProfile; counters?: RenderingCounters };
export function ApplyRenderingAttributes(root: HTMLElement, profile: RenderingProfile) {
  root.setAttribute("data-jel-highlight", profile.highlight);
  for (const key of ["scale", "verticalMotion", "glow", "blur"] as const) root.setAttribute(`data-jel-${key}`, profile[key] ? "on" : "off");
}
export function TrackedSpring(initial: number, damping: number, frequency: number, counters?: RenderingCounters) {
  if (counters) counters.springsAllocated++;
  return new Spring(initial, damping, frequency);
}
export function ReconcileSprings(old: TextSprings | undefined, profile: RenderingProfile, parameters: SpringParameters, counters?: RenderingCounters): TextSprings | undefined {
  if (!profile.scale && !profile.verticalMotion && !profile.glow) return undefined;
  return {
    Scale: profile.scale ? old?.Scale || TrackedSpring(0, ...parameters.scale, counters) : undefined,
    YOffset: profile.verticalMotion ? old?.YOffset || TrackedSpring(0, ...parameters.vertical, counters) : undefined,
    Glow: profile.glow ? old?.Glow || TrackedSpring(0, ...parameters.glow, counters) : undefined,
  };
}
export function EffectProperty(element: HTMLElement, name: string, value: string, counters?: RenderingCounters) {
  // Avoid repeated DOM writes once a boundary/settled effect has the same value.
  if (element.style.getPropertyValue(name) === value) return;
  element.style.setProperty(name, value);
  if (counters) counters.effectWrites++;
}
export function ClearDisabledEffects(element: HTMLElement, profile: RenderingProfile, counters?: RenderingCounters) {
  for (const [enabled, properties] of [
    [profile.scale, ["scale"]], [profile.verticalMotion, ["transform"]],
    [profile.glow, ["--text-shadow-blur-radius", "--text-shadow-opacity"]],
    [profile.highlight !== "off", ["--gradient-progress"]],
  ] as const) if (!enabled) for (const property of properties) {
    if (!element.style.getPropertyValue(property)) continue;
    element.style.removeProperty(property);
    if (counters) counters.effectWrites++;
  }
}
