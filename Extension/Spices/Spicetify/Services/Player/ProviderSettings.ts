// Credentials belong to this installation, never the bundle or diagnostics.
const key = "BeautifulLyricsLocal/SpicyToken";
const listeners = new Set<() => void>();
const behaviorListeners = new Set<() => void>();
export const Providers = ["Musixmatch", "AMLL", "LRCLIB", "Spotify", "Spicy"] as const;
export type BehaviorSettings = {
  fetchMode: "change" | "required";
  sidebarEnabled: boolean;
  providers: Record<(typeof Providers)[number], boolean>;
};
const behaviorKey = "BeautifulLyricsLocal/Behavior";
export function GetBehaviorSettings(): BehaviorSettings {
  let saved: any;
  try {
    saved = JSON.parse(localStorage.getItem(behaviorKey) || "{}");
  } catch {
    saved = {};
  }
  return {
    fetchMode: saved?.fetchMode === "required" ? "required" : "change",
    // Preserve the previous sidebar behavior until explicitly switched off.
    sidebarEnabled: saved?.sidebarEnabled !== false,
    providers: Object.fromEntries(
      Providers.map((name) => [name, saved?.providers?.[name] !== false]),
    ) as BehaviorSettings["providers"],
  };
}
export const IsProviderEnabled = (name: (typeof Providers)[number]) =>
  GetBehaviorSettings().providers[name];
export function SaveProviderSettings(
  token: string,
  behavior: BehaviorSettings,
) {
  const before = GetBehaviorSettings();
  const oldToken = GetSpicyToken();
  token = token.trim();
  localStorage.setItem(behaviorKey, JSON.stringify(behavior));
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
  const after = GetBehaviorSettings();
  // Only source/credential edits invalidate provider results. Consumer demand
  // changes use their own event and retain completed lyrics/source selection.
  if (oldToken !== token || JSON.stringify(before.providers) !== JSON.stringify(after.providers)) {
    for (const listener of listeners) listener();
  }
  if (before.sidebarEnabled !== after.sidebarEnabled || before.fetchMode !== after.fetchMode) {
    for (const listener of behaviorListeners) listener();
  }
}
// Immediate behavior controls must never rewrite credentials (including raw
// legacy bytes) from a stale password field in an already-open settings form.
export function SaveBehaviorSettings(behavior: BehaviorSettings) {
  const before = GetBehaviorSettings();
  if (JSON.stringify(before) === JSON.stringify(behavior)) return;
  localStorage.setItem(behaviorKey, JSON.stringify(behavior));
  const after = GetBehaviorSettings();
  if (JSON.stringify(before.providers) !== JSON.stringify(after.providers)) for (const listener of listeners) listener();
  if (before.sidebarEnabled !== after.sidebarEnabled || before.fetchMode !== after.fetchMode) {
    for (const listener of behaviorListeners) listener();
  }
}
export const GetSpicyToken = () => (localStorage.getItem(key) || "").trim();
export function SetSpicyToken(value: string) {
  value = value.trim();
  if (value === GetSpicyToken()) return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
  for (const listener of listeners) listener();
}
export function OnProviderSettingsChanged(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function OnBehaviorSettingsChanged(listener: () => void) {
  behaviorListeners.add(listener);
  return () => { behaviorListeners.delete(listener); };
}
