// Paint choices belong to each viewer, independently of source timing/effects.
export type ContextAppearance = {
  mode: "hide" | "muted";
  blurEnabled: boolean; blur: number;
  darkeningEnabled: boolean; darkening: number;
  opacity: number;
};
export const ClassicContextAppearance: Readonly<ContextAppearance> = Object.freeze({
  mode: "hide", blurEnabled: true, blur: 2, darkeningEnabled: true, darkening: 60, opacity: 35,
});
export function NormalizeContextAppearance(value?: Partial<ContextAppearance>): ContextAppearance {
  const result = { ...ClassicContextAppearance };
  if (value?.mode === "hide" || value?.mode === "muted") result.mode = value.mode;
  for (const key of ["blurEnabled", "darkeningEnabled"] as const)
    if (typeof value?.[key] === "boolean") result[key] = value[key]!;
  for (const [key, maximum] of [["blur", 12], ["darkening", 100], ["opacity", 100]] as const) {
    const item = value?.[key];
    if (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= maximum) result[key] = item;
  }
  return result;
}
