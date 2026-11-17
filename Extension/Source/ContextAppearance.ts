// Paint choices belong to each viewer, independently of source timing/effects.
export type ContextAppearance = {
  mode: "hide" | "muted";
  blurEnabled: boolean; blur: number;
  darkeningEnabled: boolean; darkening: number;
  opacity: number;
  fade: boolean; fadeLength: number; fadeEnd: number;
};
export const ClassicContextAppearance: Readonly<ContextAppearance> = Object.freeze({
  mode: "hide", blurEnabled: true, blur: 2, darkeningEnabled: true, darkening: 60, opacity: 35,
  fade: false, fadeLength: 4, fadeEnd: 0,
});
export function NormalizeContextAppearance(value?: Partial<ContextAppearance>): ContextAppearance {
  const result = { ...ClassicContextAppearance };
  if (value?.mode === "hide" || value?.mode === "muted") result.mode = value.mode;
  for (const key of ["blurEnabled", "darkeningEnabled", "fade"] as const)
    if (typeof value?.[key] === "boolean") result[key] = value[key]!;
  for (const [key, maximum] of [["blur", 12], ["darkening", 100], ["opacity", 100], ["fadeEnd", 100]] as const) {
    const item = value?.[key];
    if (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= maximum) result[key] = item;
  }
  const length = value?.fadeLength;
  if (typeof length === "number" && Number.isSafeInteger(length) && length >= 1 && length <= 20) result.fadeLength = length;
  return result;
}
// Percentage (0-100) for a muted line at `distance` lines (>= 1) from the
// shown range. One flat value per line; End above Opacity counts as Opacity.
export function ContextOpacity(appearance: ContextAppearance, fade: boolean, distance: number): number {
  if (!fade) return appearance.opacity;
  const end = Math.min(appearance.fadeEnd, appearance.opacity);
  return end + (appearance.opacity - end) * Math.max(0, 1 - (distance - 1) / appearance.fadeLength);
}
