// Background preferences are independent of lyric rendering and provider state.
export type BackgroundProfile = {
  mode: "animated" | "static" | "off";
  motion: "slow" | "classic" | "fast";
  brightness: number;
  paused: "animate" | "freeze";
  fps: "uncapped" | "60" | "30" | "15";
  resolution: "full" | "half" | "quarter";
};
const efficient: Readonly<BackgroundProfile> = Object.freeze({
  mode: "animated", motion: "classic", brightness: 100,
  paused: "freeze", fps: "30", resolution: "half",
});
export const DefaultBackgrounds = {
  FullLyrics: efficient,
  NowPlaying: Object.freeze({ ...efficient, mode: "off" as const }),
};
export function NormalizeBackground(value?: Partial<BackgroundProfile>, defaults = efficient): BackgroundProfile {
  const result = { ...defaults };
  if (["animated", "static", "off"].includes(value?.mode as string)) result.mode = value!.mode!;
  if (["slow", "classic", "fast"].includes(value?.motion as string)) result.motion = value!.motion!;
  if (["animate", "freeze"].includes(value?.paused as string)) result.paused = value!.paused!;
  if (["uncapped", "60", "30", "15"].includes(value?.fps as string)) result.fps = value!.fps!;
  if (["full", "half", "quarter"].includes(value?.resolution as string)) result.resolution = value!.resolution!;
  const brightness = value?.brightness;
  if (typeof brightness === "number" && Number.isInteger(brightness) && brightness >= 50 && brightness <= 150 && brightness % 5 === 0) result.brightness = brightness;
  return result;
}
// Quality is deliberately preserved: Classic describes the original look.
export const ClassicBackground = (profile: BackgroundProfile): BackgroundProfile => ({
  ...profile, mode: "animated", motion: "classic", brightness: 100, paused: "animate",
});
export const BackgroundFields = (previous: BackgroundProfile, next: BackgroundProfile) =>
  (Object.keys(next) as (keyof BackgroundProfile)[]).filter(key => previous[key] !== next[key]);
