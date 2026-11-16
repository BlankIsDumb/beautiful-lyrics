import { PresentationSettings, type PresentationView } from "./PresentationSettings.ts";
import { TimingSettings, TimingOffsetLimit } from "./TimingSettings.ts";
import type { LayoutProfile } from "./LayoutSettings.ts";
import type { BackgroundProfile } from "./BackgroundSettings.ts";

// Both settings surfaces use these control constraints. Persistence and live
// notifications still belong to the settings stores and their normalizers.
export const TimingOffsetInput = { min: -TimingOffsetLimit, max: TimingOffsetLimit, step: "0.05" } as const;
export const PrimarySizeInput = { min: .5, max: 2, step: "0.05" } as const;

export function SaveTimingOffset(scope: "Shared" | PresentationView, value: number) {
  TimingSettings.save({ Shared: TimingSettings.get("Shared"), NowPlaying: TimingSettings.get("NowPlaying"),
    FullLyrics: TimingSettings.get("FullLyrics"), [scope]: value });
}

export function SaveLayoutField<K extends keyof LayoutProfile>(view: PresentationView, key: K, value: LayoutProfile[K]) {
  PresentationSettings.saveLayout(view, { ...PresentationSettings.getLayout(view), [key]: value });
}

export function SaveBackgroundField<K extends keyof BackgroundProfile>(view: PresentationView, key: K, value: BackgroundProfile[K]) {
  PresentationSettings.saveBackground(view, { ...PresentationSettings.getBackground(view), [key]: value });
}
