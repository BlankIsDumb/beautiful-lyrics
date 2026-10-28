import { NormalizeRendering, ApplyTextPreset, ClassicRendering, NormalizeCues, type CueSettings, SourceCases, type SourceCase, type RenderingProfile } from "./RenderingSettings.ts";
// Presentation owns no provider, player or annotation dependencies. Saving a view
// preference can only notify that view; it must never invalidate source choices.
export type PresentationView = "NowPlaying" | "FullLyrics";
export const PresentationLanguages = ["Chinese", "Japanese", "Korean"] as const;
export type PresentationLanguage = (typeof PresentationLanguages)[number];
type RenderingCases = Record<SourceCase, RenderingProfile>;
type Profile = { cues: CueSettings; renderingCases: RenderingCases; japaneseForm: "romaji" | "kana"; romanizationEnabled: boolean; romanizedLanguages: Record<PresentationLanguage, boolean> };
type Settings = { version: 5; profiles: Record<PresentationView, Profile> };
const storageKey = "JustEnoughLyrics/Presentation";
const legacyKey = "BeautifulLyrics/LyricViews";

export function CreatePresentationSettings(storage: Pick<Storage, "getItem" | "setItem">) {
  const cueListeners = new Set<(view: PresentationView, fields: readonly (keyof CueSettings)[]) => void>();
  const renderingListeners = new Set<(view: PresentationView, sourceCase: SourceCase, fields: readonly (keyof RenderingProfile)[]) => void>();
  const listeners = new Set<(view: PresentationView, languages: readonly PresentationLanguage[]) => void>();
  const defaults = (): RenderingCases => ({ Word: NormalizeRendering(),
    Line: { ...ApplyTextPreset(NormalizeRendering(), "balanced"), detail: "line" } });
  const migrateCases = (saved?: any, previous?: Partial<RenderingProfile>): RenderingCases => {
    if (saved) { const base = defaults(); return { Word: NormalizeRendering(saved.Word, base.Word), Line: NormalizeRendering(saved.Line, base.Line) }; }
    const old = NormalizeRendering(previous);
    // Only an untouched Classic/Auto tuple adopts the requested new Line default.
    // Explicit custom/preset/detail choices are copied, never silently replaced.
    if (JSON.stringify(old) === JSON.stringify(ClassicRendering)) return defaults();
    return { Word: { ...old }, Line: { ...old } };
  };
  const profile = (saved?: any, enabled?: unknown, japaneseForm?: unknown, cases?: RenderingCases, cues?: CueSettings): Profile => {
    const romanizedLanguages = Object.fromEntries(PresentationLanguages.map(language =>
      [language, saved?.[language] === true],
    )) as Profile["romanizedLanguages"];
    // Old profiles had only language switches. Infer the master from those
    // choices so migration leaves the currently displayed text unchanged.
    return { cues: NormalizeCues(cues), renderingCases: cases ? migrateCases(cases) : defaults(), japaneseForm: japaneseForm === "kana" ? "kana" : "romaji", romanizationEnabled: typeof enabled === "boolean" ? enabled : Object.values(romanizedLanguages).some(Boolean), romanizedLanguages };
  };
  const parse = (key: string) => {
    try { return JSON.parse(storage.getItem(key) || "null"); }
    catch { return null; }
  };
  let settings: Settings | undefined;
  let futureVersion = false;
  const read = (): Settings => {
    if (settings) return settings;
    const saved = parse(storageKey);
    const supported = saved?.version === 1 || saved?.version === 2 || saved?.version === 3 || saved?.version === 4 || saved?.version === 5;
    futureVersion = saved?.version !== undefined && !supported;
    const legacy = parse(legacyKey);
    const seed = legacy?.Version === 1 ? legacy.Items?.RomanizedLanguages : undefined;
    // Copy, never share maps or rewrite the legacy store. A rollback still sees
    // its original settings, and editing one new profile cannot affect the other.
    settings = {
      version: 5,
      profiles: {
        NowPlaying: profile(supported ? saved.profiles?.NowPlaying?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.NowPlaying?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.NowPlaying?.japaneseForm : undefined, migrateCases(saved?.version === 5 ? saved.profiles?.NowPlaying?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering : undefined), saved?.version === 5 ? saved.profiles?.NowPlaying?.cues : { motion: saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering?.cueAnimation : undefined }),
        FullLyrics: profile(supported ? saved.profiles?.FullLyrics?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.FullLyrics?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.FullLyrics?.japaneseForm : undefined, migrateCases(saved?.version === 5 ? saved.profiles?.FullLyrics?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering : undefined), saved?.version === 5 ? saved.profiles?.FullLyrics?.cues : { motion: saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering?.cueAnimation : undefined }),
      },
    };
    return settings;
  };
  const save = (view: PresentationView, next: Profile) => {
    const current = read();
    // A downgraded build may read Classic defaults, but must not destroy a newer
    // schema. Only publish changes after persistence succeeds (e.g. quota errors).
    if (futureVersion) throw new Error("Presentation settings require a newer version.");
    const previous = current.profiles[view];
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    // Only effective text changes rebuild a renderer. Editing remembered choices
    // while the master is Off still saves them, with no unnecessary DOM work.
    const changed = PresentationLanguages.filter(language =>
      (previous.romanizationEnabled && previous.romanizedLanguages[language]) !==
      (next.romanizationEnabled && next.romanizedLanguages[language]) ||
      (language === "Japanese" && next.romanizationEnabled && next.romanizedLanguages.Japanese && previous.japaneseForm !== next.japaneseForm));
    const updated = { ...current, profiles: { ...current.profiles, [view]: next } };
    storage.setItem(storageKey, JSON.stringify(updated));
    settings = updated;
    if (changed.length || previous.japaneseForm !== next.japaneseForm || previous.romanizationEnabled !== next.romanizationEnabled || JSON.stringify(previous.romanizedLanguages) !== JSON.stringify(next.romanizedLanguages)) {
      for (const listener of listeners) listener(view, changed);
    }
    const cueFields = (["threshold", "motion"] as const).filter(key => previous.cues[key] !== next.cues[key]);
    if (cueFields.length) for (const listener of cueListeners) listener(view, cueFields);
    for (const sourceCase of SourceCases) {
      const renderingFields = (Object.keys(next.renderingCases[sourceCase]) as (keyof RenderingProfile)[])
        .filter(key => previous.renderingCases[sourceCase][key] !== next.renderingCases[sourceCase][key]);
      if (renderingFields.length) for (const listener of renderingListeners) listener(view, sourceCase, renderingFields);
    }
  };
  return {
    getCues: (view: PresentationView) => structuredClone(read().profiles[view].cues),
    saveCues: (view: PresentationView, cues: CueSettings) => save(view, { ...read().profiles[view], cues: NormalizeCues(cues) }),
    subscribeCues: (listener: (view: PresentationView, fields: readonly (keyof CueSettings)[]) => void) => {
      cueListeners.add(listener); return () => { cueListeners.delete(listener); };
    },
    getRendering: (view: PresentationView, sourceCase: SourceCase) => structuredClone(read().profiles[view].renderingCases[sourceCase]),
    saveRendering: (view: PresentationView, sourceCase: SourceCase, rendering: RenderingProfile) => save(view, {
      ...read().profiles[view], renderingCases: { ...read().profiles[view].renderingCases, [sourceCase]: NormalizeRendering(rendering) } }),
    subscribeRendering: (listener: (view: PresentationView, sourceCase: SourceCase, fields: readonly (keyof RenderingProfile)[]) => void) => {
      renderingListeners.add(listener); return () => { renderingListeners.delete(listener); };
    },
    getProfile: (view: PresentationView): Profile => structuredClone(read().profiles[view]),
    isReadOnly: () => { read(); return futureVersion; },
    isRomanized: (view: PresentationView, language: PresentationLanguage) =>
      read().profiles[view].romanizationEnabled && read().profiles[view].romanizedLanguages[language],
    saveProfile: (view: PresentationView, values: Profile) => save(view, profile(values.romanizedLanguages, values.romanizationEnabled, values.japaneseForm, values.renderingCases ?? read().profiles[view].renderingCases, values.cues ?? read().profiles[view].cues)),
    saveLanguages: (view: PresentationView, values: Profile["romanizedLanguages"]) => save(view, profile(values, undefined, read().profiles[view].japaneseForm, read().profiles[view].renderingCases, read().profiles[view].cues)),
    setRomanized: (view: PresentationView, language: PresentationLanguage, enabled: boolean) => {
      const values = { ...read().profiles[view].romanizedLanguages, [language]: enabled };
      // Enabling via the existing inline control must also turn the master on;
      // turning one language off must preserve the other remembered choices.
      save(view, profile(values, enabled || read().profiles[view].romanizationEnabled, read().profiles[view].japaneseForm, read().profiles[view].renderingCases, read().profiles[view].cues));
    },
    resetLanguages: (view: PresentationView) => save(view, profile(undefined, undefined, undefined, read().profiles[view].renderingCases, read().profiles[view].cues)),
    subscribe: (listener: (view: PresentationView, languages: readonly PresentationLanguage[]) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// Lazy storage access keeps module loading cheap and lets migration read the
// existing installation only when a view or the settings form actually needs it.
export const PresentationSettings = CreatePresentationSettings({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
