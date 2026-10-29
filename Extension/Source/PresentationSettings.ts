import { NormalizeAnnotations, NormalizeConversions, EffectiveConversion, type ConversionProfile, type AnnotationProfile } from "./AnnotationSettings.ts";
import { NormalizeRendering, ApplyTextPreset, ClassicRendering, NormalizeCues, type CueSettings, SourceCases, type SourceCase, type RenderingProfile } from "./RenderingSettings.ts";
// Presentation owns no provider, player or annotation dependencies. Saving a view
// preference can only notify that view; it must never invalidate source choices.
export type PresentationView = "NowPlaying" | "FullLyrics";
export const PresentationLanguages = ["Chinese", "Japanese", "Korean"] as const;
export type PresentationLanguage = (typeof PresentationLanguages)[number];
type RenderingCases = Record<SourceCase, RenderingProfile>;
type Profile = { conversions: ConversionProfile; annotations: AnnotationProfile; cues: CueSettings; renderingCases: RenderingCases; japaneseForm: "romaji" | "kana"; romanizationEnabled: boolean; romanizedLanguages: Record<PresentationLanguage, boolean> };
type Settings = { version: 7; profiles: Record<PresentationView, Profile> };
const storageKey = "JustEnoughLyrics/Presentation";
const legacyKey = "BeautifulLyrics/LyricViews";

export function CreatePresentationSettings(storage: Pick<Storage, "getItem" | "setItem">) {
  const annotationListeners = new Set<(view: PresentationView) => void>();
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
  const profile = (saved?: any, enabled?: unknown, japaneseForm?: unknown, cases?: RenderingCases, cues?: CueSettings, annotations?: AnnotationProfile, conversions?: ConversionProfile): Profile => {
    const romanizedLanguages = Object.fromEntries(PresentationLanguages.map(language =>
      [language, saved?.[language] === true],
    )) as Profile["romanizedLanguages"];
    // Old profiles had only language switches. Infer the master from those
    // choices so migration leaves the currently displayed text unchanged.
    const master = typeof enabled === "boolean" ? enabled : Object.values(romanizedLanguages).some(Boolean);
    const oldAnnotations = NormalizeAnnotations(annotations);
    const migrated = NormalizeConversions();
    const migrationEnabled = master || oldAnnotations.ruby || oldAnnotations.secondary !== "off";
    for (const language of PresentationLanguages) {
      const primary = master && romanizedLanguages[language];
      const ruby = !primary && language === "Japanese" && oldAnnotations.ruby;
      const secondary = !primary && !ruby && oldAnnotations.secondary !== "off";
      const choice = migrated.languages[language];
      // Preserve remembered enable flags only while the new master also stays
      // Off. Ruby/secondary can turn it On, so copying inactive primary flags
      // then would unexpectedly activate unrelated remembered languages.
      choice.enabled = migrationEnabled ? primary || ruby || secondary : romanizedLanguages[language];
      choice.placement = secondary ? "above" : "replace";
      if (language === "Japanese") {
        choice.kind = japaneseForm === "kana" ? "kana" : "romaji";
        if (ruby) choice.kind = "furigana";
        else if (secondary) choice.kind = oldAnnotations.secondary as "romaji" | "kana";
      }
    }
    migrated.enabled = migrationEnabled;
    return { conversions: conversions ? NormalizeConversions(conversions) : migrated, annotations: oldAnnotations, cues: NormalizeCues(cues), renderingCases: cases ? migrateCases(cases) : defaults(), japaneseForm: japaneseForm === "kana" ? "kana" : "romaji", romanizationEnabled: typeof enabled === "boolean" ? enabled : Object.values(romanizedLanguages).some(Boolean), romanizedLanguages };
  };
  const parse = (key: string) => {
    try { return JSON.parse(storage.getItem(key) || "null"); }
    catch { return null; }
  };
  let settings: Settings | undefined;
  let futureVersion = false;
  let migrationRaw: string | undefined;
  const read = (): Settings => {
    if (settings) return settings;
    const saved = parse(storageKey);
    const supported = saved?.version === 1 || saved?.version === 2 || saved?.version === 3 || saved?.version === 4 || saved?.version === 5 || saved?.version === 6 || saved?.version === 7;
    futureVersion = saved?.version !== undefined && !supported;
    if (saved?.version === 6) migrationRaw = storage.getItem(storageKey) || undefined;
    const legacy = parse(legacyKey);
    const seed = legacy?.Version === 1 ? legacy.Items?.RomanizedLanguages : undefined;
    // Copy, never share maps or rewrite the legacy store. A rollback still sees
    // its original settings, and editing one new profile cannot affect the other.
    settings = {
      version: 7,
      profiles: {
        NowPlaying: profile(supported ? saved.profiles?.NowPlaying?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.NowPlaying?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.NowPlaying?.japaneseForm : undefined, migrateCases(saved?.version >= 5 ? saved.profiles?.NowPlaying?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering : undefined), saved?.version >= 5 ? saved.profiles?.NowPlaying?.cues : { motion: saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering?.cueAnimation : undefined }, saved?.version >= 6 ? saved.profiles?.NowPlaying?.annotations : undefined, saved?.version === 7 ? saved.profiles?.NowPlaying?.conversions : undefined),
        FullLyrics: profile(supported ? saved.profiles?.FullLyrics?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.FullLyrics?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.FullLyrics?.japaneseForm : undefined, migrateCases(saved?.version >= 5 ? saved.profiles?.FullLyrics?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering : undefined), saved?.version >= 5 ? saved.profiles?.FullLyrics?.cues : { motion: saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering?.cueAnimation : undefined }, saved?.version >= 6 ? saved.profiles?.FullLyrics?.annotations : undefined, saved?.version === 7 ? saved.profiles?.FullLyrics?.conversions : undefined),
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
    const changed = PresentationLanguages.filter(language => JSON.stringify(EffectiveConversion(previous.conversions, language)) !== JSON.stringify(EffectiveConversion(next.conversions, language)));
    const updated = { ...current, profiles: { ...current.profiles, [view]: next } };
    // Preserve the exact old payload before publishing schema7. Failed snapshot
    // or primary writes leave the lazy in-memory state and all events untouched.
    if (migrationRaw !== undefined) storage.setItem(storageKey + "/Migration/schema6", migrationRaw);
    storage.setItem(storageKey, JSON.stringify(updated));
    migrationRaw = undefined;
    settings = updated;
    if (changed.length || JSON.stringify(previous.conversions) !== JSON.stringify(next.conversions) || previous.japaneseForm !== next.japaneseForm || previous.romanizationEnabled !== next.romanizationEnabled || JSON.stringify(previous.romanizedLanguages) !== JSON.stringify(next.romanizedLanguages)) {
      for (const listener of listeners) listener(view, changed);
    }
    if (JSON.stringify(previous.annotations) !== JSON.stringify(next.annotations)) for (const listener of annotationListeners) listener(view);
    const cueFields = (["threshold", "motion"] as const).filter(key => previous.cues[key] !== next.cues[key]);
    if (cueFields.length) for (const listener of cueListeners) listener(view, cueFields);
    for (const sourceCase of SourceCases) {
      const renderingFields = (Object.keys(next.renderingCases[sourceCase]) as (keyof RenderingProfile)[])
        .filter(key => previous.renderingCases[sourceCase][key] !== next.renderingCases[sourceCase][key]);
      if (renderingFields.length) for (const listener of renderingListeners) listener(view, sourceCase, renderingFields);
    }
  };
  return {
    saveConversions: (view: PresentationView, conversions: ConversionProfile) => save(view, { ...read().profiles[view], conversions: NormalizeConversions(conversions) }),
    getConversions: (view: PresentationView) => structuredClone(read().profiles[view].conversions),
    getAnnotations: (view: PresentationView) => structuredClone(read().profiles[view].annotations),
    saveAnnotations: (view: PresentationView, annotations: AnnotationProfile) => save(view, { ...read().profiles[view], annotations: NormalizeAnnotations(annotations) }),
    subscribeAnnotations: (listener: (view: PresentationView) => void) => { annotationListeners.add(listener); return () => { annotationListeners.delete(listener); }; },
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
    // Legacy callers see an adapter over the canonical conversion model, never
    // a second independently mutable master/language map.
    getProfile: (view: PresentationView): Profile => {
      const current = structuredClone(read().profiles[view]);
      return { ...current, romanizationEnabled: current.conversions.enabled,
        romanizedLanguages: Object.fromEntries(PresentationLanguages.map(language => [language, current.conversions.languages[language].enabled])) as Profile["romanizedLanguages"],
        japaneseForm: current.conversions.languages.Japanese.kind === "romaji" ? "romaji" : "kana" };
    },
    isReadOnly: () => { read(); return futureVersion; },
    isRomanized: (view: PresentationView, language: PresentationLanguage) => !!EffectiveConversion(read().profiles[view].conversions, language),
    saveProfile: (view: PresentationView, values: Profile) => {
      const current = read().profiles[view];
      const conversions = structuredClone(current.conversions);
      // Old read/modify/write controls can still change enable/form, preserving
      // each language's remembered placement and all unrelated modern choices.
      if (values.romanizationEnabled !== current.conversions.enabled) conversions.enabled = values.romanizationEnabled === true;
      for (const language of PresentationLanguages) if (values.romanizedLanguages[language] !== current.conversions.languages[language].enabled)
        conversions.languages[language].enabled = values.romanizedLanguages[language] === true;
      const oldForm = current.conversions.languages.Japanese.kind === "romaji" ? "romaji" : "kana";
      if (values.japaneseForm !== oldForm) conversions.languages.Japanese.kind = values.japaneseForm;
      save(view, { ...current, ...values, conversions: NormalizeConversions(conversions), annotations: NormalizeAnnotations(values.annotations),
        renderingCases: migrateCases(values.renderingCases), cues: NormalizeCues(values.cues) });
    },
    saveLanguages: (view: PresentationView, values: Profile["romanizedLanguages"]) => {
      const current = read().profiles[view], conversions = structuredClone(current.conversions);
      for (const language of PresentationLanguages) conversions.languages[language].enabled = values[language] === true;
      conversions.enabled = Object.values(values).some(Boolean); save(view, { ...current, conversions });
    },
    setRomanized: (view: PresentationView, language: PresentationLanguage, enabled: boolean) => {
      const current = read().profiles[view], conversions = structuredClone(current.conversions);
      conversions.languages[language].enabled = enabled;
      if (enabled) conversions.enabled = true;
      save(view, { ...current, conversions });
    },
    resetLanguages: (view: PresentationView) => save(view, { ...read().profiles[view], conversions: NormalizeConversions() }),
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
