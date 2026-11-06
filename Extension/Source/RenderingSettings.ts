// Pure text-rendering policy. Providers, annotations, transport and backgrounds
// do not depend on these preferences. Presets are one-time editable snapshots.
export type SourceCase = "Word" | "Line";
export const SourceCases = ["Word", "Line"] as const;
export const SourceCaseFor = (precision: "static" | "line" | "word"): SourceCase | undefined => precision === "static" ? undefined : precision === "word" ? "Word" : "Line";
export type TextDetail = "auto" | "line" | "word";
export type TextHighlight = "classic" | "off" | "segment" | "progressive";
export type TextPreset = "classic" | "minimal" | "balanced" | "custom";
export type AnimationEasing = "classic" | "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type AnimationResponse = "classic" | "slow" | "fast" | "direct";
export const AnimationFields = ["animationEasing", "animationResponse"] as const;
export type RenderingProfile = {
  detail: TextDetail; preset: TextPreset; highlight: TextHighlight;
  scale: boolean; verticalMotion: boolean; glow: boolean; blur: boolean;
  emphasis: boolean;
  animationEasing: AnimationEasing;
  animationResponse: AnimationResponse;
};
export const ClassicRendering: Readonly<RenderingProfile> = Object.freeze({
  detail: "auto", preset: "classic", highlight: "classic", scale: true,
  verticalMotion: true, glow: true, blur: true, emphasis: true,
  animationEasing: "classic", animationResponse: "classic",
});
export function NormalizeRendering(value?: Partial<RenderingProfile>, defaults: Readonly<RenderingProfile> = ClassicRendering): RenderingProfile {
  const result: RenderingProfile = { ...defaults, animationEasing: "classic", animationResponse: "classic" };
  if (["auto", "line", "word"].includes(value?.detail!)) result.detail = value!.detail!;
  if (["classic", "minimal", "balanced", "custom"].includes(value?.preset!)) result.preset = value!.preset!;
  if (["classic", "off", "segment", "progressive"].includes(value?.highlight!)) result.highlight = value!.highlight!;
  if (["classic", "linear", "ease-in", "ease-out", "ease-in-out"].includes(value?.animationEasing!)) result.animationEasing = value!.animationEasing!;
  if (["classic", "slow", "fast", "direct"].includes(value?.animationResponse!)) result.animationResponse = value!.animationResponse!;
  for (const key of ["scale", "verticalMotion", "glow", "blur", "emphasis"] as const) {
    if (typeof value?.[key] === "boolean") result[key] = value[key]!;
  }
  // Detail is an independent preference: preset identity describes the effect
  // snapshot only. A hand-edited tuple must never still claim a named preset.
  if (result.preset !== "custom") {
    const expected = ApplyTextPreset(result, result.preset);
    if (Object.keys(expected).some(key => key !== "detail" && key !== "preset" &&
      result[key as keyof RenderingProfile] !== expected[key as keyof RenderingProfile])) result.preset = "custom";
  }
  return result;
}
export function ApplyTextPreset(current: RenderingProfile, preset: Exclude<TextPreset, "custom">): RenderingProfile {
  if (preset === "classic") return { ...ClassicRendering, detail: current.detail };
  return { detail: current.detail, preset, highlight: preset === "minimal" ? "off" : "progressive",
    scale: false, verticalMotion: false, glow: false, blur: false, emphasis: false,
    animationEasing: "classic", animationResponse: "classic" };
}
export const ContinuousTextEffects = (profile: RenderingProfile) =>
  profile.highlight === "classic" || profile.highlight === "progressive" || profile.scale || profile.verticalMotion || profile.glow;
export const LetterEmphasis = (profile: RenderingProfile) => profile.emphasis &&
  (profile.highlight === "classic" || profile.highlight === "progressive" || profile.scale || profile.verticalMotion || profile.glow);

// Optional per-view instrumentation for synthetic/native fixtures. Production
// does not allocate counters unless a caller explicitly supplies them.
export type RenderingCounters = {
  ticks: number; timelineEvaluations: number; boundaryUpdates: number;
  continuousUpdates: number; springsAllocated: number; springUpdates: number;
  effectWrites: number; blurCalculations: number;
};
export const CreateRenderingCounters = (): RenderingCounters => ({ ticks: 0, timelineEvaluations: 0,
  boundaryUpdates: 0, continuousUpdates: 0, springsAllocated: 0, springUpdates: 0, effectWrites: 0, blurCalculations: 0 });


// Cue settings belong to the view. A zero threshold disables cues, and a null
// display window uses the full eligible gap.
export type CueSettings = { threshold: number; motion: boolean; lastSeconds: number | null };
export const NormalizeCues = (value?: Partial<CueSettings>): CueSettings => ({
  threshold: typeof value?.threshold === "number" && Number.isFinite(value.threshold) && value.threshold >= 0 ? value.threshold : 2,
  motion: typeof value?.motion === "boolean" ? value.motion : true,
  lastSeconds: typeof value?.lastSeconds === "number" && Number.isFinite(value.lastSeconds) && value.lastSeconds > 0 ? value.lastSeconds : null,
});
