import { ClassicRendering, ApplyTextPreset, NormalizeRendering, type RenderingProfile, type SourceCase } from "./RenderingSettings.ts";

export type AnnotationEffects = { inherit: boolean; effects: RenderingProfile };
export type AnnotationProfile = {
  secondary: "off" | "romaji" | "kana"; ruby: boolean;
  secondarySize: number; rubySize: number; gap: number; spacing: number; opacity: number;
  alignment: "inherit" | "start" | "center" | "end";
  cases: Record<SourceCase, AnnotationEffects>;
};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
export function NormalizeAnnotations(value?: Partial<AnnotationProfile>): AnnotationProfile {
  const effects = (sourceCase: SourceCase): AnnotationEffects => ({
    inherit: value?.cases?.[sourceCase]?.inherit !== false,
    effects: { ...NormalizeRendering(value?.cases?.[sourceCase]?.effects, sourceCase === "Line" ? ApplyTextPreset({ ...ClassicRendering }, "balanced") : ClassicRendering), emphasis: false, preset: "custom" },
  });
  return {
    secondary: value?.secondary === "romaji" || value?.secondary === "kana" ? value.secondary : "off",
    ruby: value?.ruby === true,
    secondarySize: number(value?.secondarySize, .6, .25, 1.5), rubySize: number(value?.rubySize, .5, .25, 1),
    gap: number(value?.gap, .15, 0, 2), spacing: number(value?.spacing, 0, -.1, .5), opacity: number(value?.opacity, .8, 0, 1),
    alignment: ["start", "center", "end"].includes(value?.alignment!) ? value!.alignment! : "inherit",
    cases: { Word: effects("Word"), Line: effects("Line") },
  };
}
// Annotation progress is a mapping of source intervals, never acoustic letter
// timing. Inherited and custom effects both keep character emphasis disabled.
export function AnnotationRendering(settings: AnnotationProfile, sourceCase: SourceCase | undefined,
  primary: RenderingProfile = { ...ClassicRendering }): RenderingProfile {
  const selected = sourceCase && settings.cases[sourceCase];
  return { ...(selected && !selected.inherit ? selected.effects : primary), detail: primary.detail, emphasis: false };
}

// One conversion per language; placement is remembered even while Furigana
// temporarily forces attached readings. No UI boolean combinations to reconcile.
export type ConversionChoice = { enabled: boolean; kind: "romaji" | "kana" | "furigana" | "pinyin" | "romaja"; placement: "replace" | "above" };
export type ConversionProfile = { enabled: boolean; languages: Record<"Japanese" | "Chinese" | "Korean", ConversionChoice> };
export function NormalizeConversions(value?: Partial<ConversionProfile>): ConversionProfile {
  const choice = (language: "Japanese" | "Chinese" | "Korean"): ConversionChoice => {
    const saved = value?.languages?.[language];
    const allowed = language === "Japanese" ? ["romaji", "kana", "furigana"] : language === "Chinese" ? ["pinyin"] : ["romaja"];
    return { enabled: saved?.enabled === true, kind: allowed.includes(saved?.kind!) ? saved!.kind : allowed[0] as ConversionChoice["kind"], placement: saved?.placement === "above" ? "above" : "replace" };
  };
  return { enabled: value?.enabled === true, languages: { Japanese: choice("Japanese"), Chinese: choice("Chinese"), Korean: choice("Korean") } };
}
export function EffectiveConversion(profile: ConversionProfile, language?: "Japanese" | "Chinese" | "Korean") {
  if (!language || !profile.enabled || !profile.languages[language].enabled) return undefined;
  const choice = profile.languages[language];
  return { ...choice, placement: choice.kind === "furigana" ? "attached" as const : choice.placement,
    form: choice.kind === "kana" || choice.kind === "furigana" ? "kana" as const : "romaji" as const };
}
