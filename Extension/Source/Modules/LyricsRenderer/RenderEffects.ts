import Spring from "@Universal/Modules/LegacySpring.ts";
import { AnimationFields, type AnimationEasing, type AnimationResponse, type RenderingCounters, type RenderingProfile } from "../../RenderingSettings.ts";
import { GetSpline } from "./SharedMethods.ts";
import type { TimeValue } from "./Types.d.ts";

export type TextSprings = { Scale?: Spring; YOffset?: Spring; Glow?: Spring };
export type SpringParameters = { scale: readonly [number, number]; vertical: readonly [number, number]; glow: readonly [number, number] };
export type VocalRenderOptions = { root?: HTMLDivElement; profile?: RenderingProfile; counters?: RenderingCounters };
const responseRate = { classic: 1, slow: .5, fast: 2, direct: 0 } satisfies Record<AnimationResponse, number>;

export function EffectCurve(points: TimeValue[]) {
  let classic: ReturnType<typeof GetSpline> | undefined;
  return (time: number, easing: AnimationEasing = "classic") => {
    if (easing === "classic") return (classic ??= GetSpline(points)).at(time);
    if (time <= points[0].Time) return points[0].Value;
    for (let i = 1; i < points.length; i++) {
      const end = points[i];
      if (time > end.Time) continue;
      if (time === end.Time) return end.Value;
      const start = points[i - 1];
      const t = (time - start.Time) / (end.Time - start.Time);
      const phase = easing === "ease-in" ? t * t : easing === "ease-out" ? 1 - (1 - t) ** 2
        : easing === "ease-in-out" ? t * t * (3 - 2 * t) : t;
      return start.Value + (end.Value - start.Value) * phase;
    }
    return points[points.length - 1].Value;
  };
}

const AnimationChanged = (before: RenderingProfile, after: RenderingProfile) =>
  AnimationFields.some(field => before[field] !== after[field]);
export const OnlyAnimationChanged = (before: RenderingProfile, after: RenderingProfile) =>
  AnimationChanged(before, after) && before.detail === after.detail && before.highlight === after.highlight &&
  before.scale === after.scale && before.verticalMotion === after.verticalMotion && before.glow === after.glow &&
  before.blur === after.blur && before.emphasis === after.emphasis;

export function ApplyRenderingAttributes(root: HTMLElement, profile: RenderingProfile) {
  root.setAttribute("data-jel-highlight", profile.highlight);
  for (const key of ["scale", "verticalMotion", "glow", "blur"] as const) root.setAttribute(`data-jel-${key}`, profile[key] ? "on" : "off");
}
export function ApplyLineAnimationAttributes(root: HTMLElement, profile: RenderingProfile) {
  // The Classic declarations already provide the default transition. Publish
  // overrides only on line owners, including independently styled readings.
  for (const [name, value] of [["easing", profile.animationEasing], ["response", profile.animationResponse]] as const) {
    const attribute = `data-jel-line-${name}`;
    if (value && value !== "classic" && profile.scale) {
      if (root.getAttribute(attribute) !== value) root.setAttribute(attribute, value);
    } else if (root.hasAttribute(attribute)) root.removeAttribute(attribute);
  }
}
export function TrackedSpring(initial: number, damping: number, frequency: number, counters?: RenderingCounters) {
  if (counters) counters.springsAllocated++;
  return new Spring(initial, damping, frequency);
}
export function ReconcileEffectSpring(old: Spring | undefined, enabled: boolean, parameters: readonly [number, number], response: AnimationResponse = "classic", counters?: RenderingCounters, initial = 0) {
  if (!enabled || response === "direct") return undefined;
  const [damping, frequency] = parameters;
  const selectedFrequency = frequency * responseRate[response];
  if (!old) return TrackedSpring(initial, damping, selectedFrequency, counters);
  old.SetFrequency(selectedFrequency);
  return old;
}
export function ReconcileSprings(old: TextSprings | undefined, profile: RenderingProfile, parameters: SpringParameters, counters?: RenderingCounters): TextSprings | undefined {
  const response = profile.animationResponse;
  if (response === "direct" || (!profile.scale && !profile.verticalMotion && !profile.glow)) return undefined;
  return {
    Scale: ReconcileEffectSpring(old?.Scale, profile.scale, parameters.scale, response, counters),
    YOffset: ReconcileEffectSpring(old?.YOffset, profile.verticalMotion, parameters.vertical, response, counters),
    Glow: ReconcileEffectSpring(old?.Glow, profile.glow, parameters.glow, response, counters),
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
