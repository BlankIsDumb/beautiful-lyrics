// Credentials belong to this installation, never the bundle or diagnostics.
const key = "BeautifulLyricsLocal/SpicyToken";
const listeners = new Set<() => void>();
export const Providers = ["Musixmatch", "AMLL", "LRCLIB", "Spicy"] as const;
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
  const before = JSON.stringify(GetBehaviorSettings());
  const oldToken = GetSpicyToken();
  token = token.trim();
  localStorage.setItem(behaviorKey, JSON.stringify(behavior));
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
  // Notify once for the whole form, avoiding multiple lyric reloads per save.
  if (oldToken !== token || before !== JSON.stringify(GetBehaviorSettings())) {
    for (const listener of listeners) listener();
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
