import type { PresentationView } from "./PresentationSettings.ts";

type Scope = "Shared" | PresentationView;
type Values = Record<Scope, number>;
const key = "JustEnoughLyrics/Timing";
export const TimingOffsetLimit = 30;

// Seconds, positive = lyrics later. Keep timing separate from language/provider
// notifications: a paused adjustment only reevaluates the existing view.
export function CreateTimingSettings(storage: Pick<Storage, "getItem" | "setItem">) {
  let values: Values | undefined;
  let readOnly = false;
  const listeners = new Set<(scopes: readonly Scope[]) => void>();
  const normalize = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? Math.max(-TimingOffsetLimit, Math.min(TimingOffsetLimit, value)) : 0;
  const read = () => {
    if (values) return values;
    let saved: any;
    try { saved = JSON.parse(storage.getItem(key) || "null"); } catch { /* Classic zero delay */ }
    readOnly = saved?.version !== undefined && saved.version !== 1;
    const offsets = saved?.version === 1 ? saved.offsets : undefined;
    return values = { Shared: normalize(offsets?.Shared), NowPlaying: normalize(offsets?.NowPlaying), FullLyrics: normalize(offsets?.FullLyrics) };
  };
  return {
    get: (scope: Scope) => read()[scope],
    isReadOnly: () => { read(); return readOnly; },
    save: (next: Values) => {
      const previous = read();
      if (readOnly) throw new Error("Timing settings require a newer version.");
      const updated = { Shared: normalize(next.Shared), NowPlaying: normalize(next.NowPlaying), FullLyrics: normalize(next.FullLyrics) };
      const changed = (Object.keys(updated) as Scope[]).filter(scope => previous[scope] !== updated[scope]);
      if (!changed.length) return;
      storage.setItem(key, JSON.stringify({ version: 1, offsets: updated }));
      values = updated;
      // One persistence operation publishes one batch, even if multiple scopes change.
      // Consumers can compare the effective sum before doing a seek-sized update.
      for (const listener of listeners) listener(changed);
    },
    subscribe: (listener: (scopes: readonly Scope[]) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const TimingSettings = CreateTimingSettings({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
