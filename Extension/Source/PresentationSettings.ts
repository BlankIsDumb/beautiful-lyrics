import { NormalizeContextAppearance, type ContextAppearance } from "./ContextAppearance.ts";
import { HorizontalSurfaces, NormalizeHorizontalSpacing, type HorizontalSurface } from "./HorizontalSpacing.ts";
import { NormalizeLayout, NormalizeFontFamily, LayoutFields, LayoutCategories, DefaultLayouts, type LayoutProfile, type LayoutCategory } from "./LayoutSettings.ts";
import { NormalizeAnnotations, NormalizeConversions, EffectiveConversion, type ConversionProfile, type AnnotationProfile } from "./AnnotationSettings.ts";
import { NormalizeRendering, ApplyTextPreset, ClassicRendering, NormalizeCues, type CueSettings, SourceCases, type SourceCase, type RenderingProfile } from "./RenderingSettings.ts";
// Presentation owns no provider, player or annotation dependencies. Saving a view
// preference can only notify that view; it must never invalidate source choices.
export type PresentationView = "NowPlaying" | "FullLyrics";
export const PresentationLanguages = ["Chinese", "Japanese", "Korean"] as const;
export type PresentationLanguage = (typeof PresentationLanguages)[number];
type RenderingCases = Record<SourceCase, RenderingProfile>;
type Profile = { contextAppearance: ContextAppearance; layout: LayoutProfile; conversions: ConversionProfile; annotations: AnnotationProfile; cues: CueSettings; renderingCases: RenderingCases; japaneseForm: "romaji" | "kana"; romanizationEnabled: boolean; romanizedLanguages: Record<PresentationLanguage, boolean> };
type Settings = { version: 10; fontFamily: string; horizontalSpacing: Record<HorizontalSurface, number>; profiles: Record<PresentationView, Profile> };
const storageKey = "JustEnoughLyrics/Presentation";
const legacyKey = "BeautifulLyrics/LyricViews";

export function CreatePresentationSettings(storage: Pick<Storage, "getItem" | "setItem">) {
  const contextAppearanceListeners = new Set<(view: PresentationView) => void>();
  const layoutListeners = new Set<(view: PresentationView, fields: readonly (keyof LayoutProfile)[]) => void>();
  const spacingListeners = new Set<(surface: HorizontalSurface) => void>();
  const previews = new Map<HorizontalSurface, {owner: object; value: number}>();
  const notifySpacing = (surface: HorizontalSurface) => { for (const listener of spacingListeners) listener(surface); };
  const familyListeners = new Set<() => void>();
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
  const profile = (view: PresentationView, saved?: any, enabled?: unknown, japaneseForm?: unknown, cases?: RenderingCases, cues?: CueSettings, annotations?: AnnotationProfile, conversions?: ConversionProfile): Profile => {
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
    return { contextAppearance: NormalizeContextAppearance(), layout: NormalizeLayout(undefined, DefaultLayouts[view]), conversions: conversions ? NormalizeConversions(conversions) : migrated, annotations: oldAnnotations, cues: NormalizeCues(cues), renderingCases: cases ? migrateCases(cases) : defaults(), japaneseForm: japaneseForm === "kana" ? "kana" : "romaji", romanizationEnabled: typeof enabled === "boolean" ? enabled : Object.values(romanizedLanguages).some(Boolean), romanizedLanguages };
  };
  const parse = (key: string) => {
    try { return JSON.parse(storage.getItem(key) || "null"); }
    catch { return null; }
  };
  let settings: Settings | undefined;
  let futureVersion = false;
  let migrationRaw: string | undefined;
  let migrationVersion: number | undefined;
  let migrationBackupKey: string | undefined;
  const read = (): Settings => {
    if (settings) return settings;
    const saved = parse(storageKey);
    const supported = saved?.version === 1 || saved?.version === 2 || saved?.version === 3 || saved?.version === 4 || saved?.version === 5 || saved?.version === 6 || saved?.version === 7 || saved?.version === 8 || saved?.version === 9 || saved?.version === 10;
    futureVersion = saved?.version !== undefined && !supported;
    if (supported && saved.version < 10) { migrationRaw = storage.getItem(storageKey) || undefined; migrationVersion = saved.version; }
    const legacy = parse(legacyKey);
    const seed = legacy?.Version === 1 ? legacy.Items?.RomanizedLanguages : undefined;
    // Copy, never share maps or rewrite the legacy store. A rollback still sees
    // its original settings, and editing one new profile cannot affect the other.
    settings = {
      version: 10,
      horizontalSpacing: Object.fromEntries(HorizontalSurfaces.map(surface => [surface, saved?.version >= 9 ? NormalizeHorizontalSpacing(saved.horizontalSpacing?.[surface]) : 0])) as Record<HorizontalSurface, number>,
      fontFamily: saved?.version >= 8 ? NormalizeFontFamily(saved.fontFamily) : "",
      profiles: {
        NowPlaying: profile("NowPlaying", supported ? saved.profiles?.NowPlaying?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.NowPlaying?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.NowPlaying?.japaneseForm : undefined, migrateCases(saved?.version >= 5 ? saved.profiles?.NowPlaying?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering : undefined), saved?.version >= 5 ? saved.profiles?.NowPlaying?.cues : { motion: saved?.version === 4 ? saved.profiles?.NowPlaying?.rendering?.cueAnimation : undefined }, saved?.version >= 6 ? saved.profiles?.NowPlaying?.annotations : undefined, saved?.version >= 7 ? saved.profiles?.NowPlaying?.conversions : undefined),
        FullLyrics: profile("FullLyrics", supported ? saved.profiles?.FullLyrics?.romanizedLanguages : seed, supported && saved?.version >= 2 ? saved.profiles?.FullLyrics?.romanizationEnabled : undefined, supported && saved?.version >= 3 ? saved.profiles?.FullLyrics?.japaneseForm : undefined, migrateCases(saved?.version >= 5 ? saved.profiles?.FullLyrics?.renderingCases : undefined, saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering : undefined), saved?.version >= 5 ? saved.profiles?.FullLyrics?.cues : { motion: saved?.version === 4 ? saved.profiles?.FullLyrics?.rendering?.cueAnimation : undefined }, saved?.version >= 6 ? saved.profiles?.FullLyrics?.annotations : undefined, saved?.version >= 7 ? saved.profiles?.FullLyrics?.conversions : undefined),
      },
    };
    if (saved?.version >= 8) for (const view of ["NowPlaying", "FullLyrics"] as const) settings.profiles[view].layout = NormalizeLayout(saved.profiles?.[view]?.layout, DefaultLayouts[view]);
    if (saved?.version === 10) for (const view of ["NowPlaying", "FullLyrics"] as const) settings.profiles[view].contextAppearance = NormalizeContextAppearance(saved.profiles?.[view]?.contextAppearance);
    return settings;
  };
  // All save families share the same lazy transaction: exact old raw first,
  // canonical payload second, and only then observable in-memory state/events.
  const persist = (updated: Settings) => {
    if (futureVersion) throw new Error("Presentation settings require a newer version.");
    if (migrationRaw !== undefined) {
      if (!migrationBackupKey) {
        const base = storageKey + "/Migration/schema" + migrationVersion;
        const existing = storage.getItem(base);
        migrationBackupKey = existing === null || existing === migrationRaw ? base : base + "/" + Date.now();
        // Millisecond collisions must not overwrite another distinct recovery copy.
        let suffix = 0;
        while (storage.getItem(migrationBackupKey) !== null && storage.getItem(migrationBackupKey) !== migrationRaw) migrationBackupKey = base + "/" + Date.now() + "-" + (++suffix);
      }
      storage.setItem(migrationBackupKey, migrationRaw);
    }
    storage.setItem(storageKey, JSON.stringify(updated));
    migrationRaw = undefined;
    settings = updated;
  };
  const saveSpacing = (surface: HorizontalSurface, value: number) => {
    const current = read(), normalized = NormalizeHorizontalSpacing(value);
    if (futureVersion) throw new Error("Presentation settings require a newer version.");
    if (current.horizontalSpacing[surface] === normalized) return;
    persist({...current, horizontalSpacing: {...current.horizontalSpacing, [surface]: normalized}});
    if(!previews.has(surface))notifySpacing(surface);
  };
  const save = (view: PresentationView, next: Profile, spacing = read().horizontalSpacing) => {
    const current = read();
    // A downgraded build may read Classic defaults, but must not destroy a newer
    // schema. Only publish changes after persistence succeeds (e.g. quota errors).
    if (futureVersion) throw new Error("Presentation settings require a newer version.");
    const previous = current.profiles[view];
    const changedSurfaces=HorizontalSurfaces.filter(surface=>current.horizontalSpacing[surface]!==spacing[surface]);
    if (JSON.stringify(previous) === JSON.stringify(next) && !changedSurfaces.length) return;
    // Only effective text changes rebuild a renderer. Editing remembered choices
    // while the master is Off still saves them, with no unnecessary DOM work.
    const changed = PresentationLanguages.filter(language => JSON.stringify(EffectiveConversion(previous.conversions, language)) !== JSON.stringify(EffectiveConversion(next.conversions, language)));
    const updated = { ...current, horizontalSpacing: spacing, profiles: { ...current.profiles, [view]: next } };
    // Preserve the exact old payload before publishing schema10. Failed snapshot
    // or primary writes leave the lazy in-memory state and all events untouched.
    persist(updated);
    for(const surface of changedSurfaces)notifySpacing(surface);
    if (changed.length || JSON.stringify(previous.conversions) !== JSON.stringify(next.conversions) || previous.japaneseForm !== next.japaneseForm || previous.romanizationEnabled !== next.romanizationEnabled || JSON.stringify(previous.romanizedLanguages) !== JSON.stringify(next.romanizedLanguages)) {
      for (const listener of listeners) listener(view, changed);
    }
    if (JSON.stringify(previous.annotations) !== JSON.stringify(next.annotations)) for (const listener of annotationListeners) listener(view);
    const cueFields = (["threshold", "motion"] as const).filter(key => previous.cues[key] !== next.cues[key]);
    if (cueFields.length) for (const listener of cueListeners) listener(view, cueFields);
    if (JSON.stringify(previous.contextAppearance) !== JSON.stringify(next.contextAppearance)) for (const listener of contextAppearanceListeners) listener(view);
    const layoutFields = LayoutFields(previous.layout, next.layout);
    if (layoutFields.length) for (const listener of layoutListeners) listener(view, layoutFields);
    for (const sourceCase of SourceCases) {
      const renderingFields = (Object.keys(next.renderingCases[sourceCase]) as (keyof RenderingProfile)[])
        .filter(key => previous.renderingCases[sourceCase][key] !== next.renderingCases[sourceCase][key]);
      if (renderingFields.length) for (const listener of renderingListeners) listener(view, sourceCase, renderingFields);
    }
  };
  return {
    getHorizontalSpacing: (surface: HorizontalSurface) => read().horizontalSpacing[surface],
    getEffectiveHorizontalSpacing: (surface: HorizontalSurface) => previews.get(surface)?.value ?? read().horizontalSpacing[surface],
    saveHorizontalSpacing: saveSpacing,
    subscribeHorizontalSpacing: (listener: (surface: HorizontalSurface) => void) => { spacingListeners.add(listener); return () => { spacingListeners.delete(listener); }; },
    createHorizontalPreview: (surface: HorizontalSurface) => {
      const owner = {}; let disposed = false;
      const cancel = () => { if (previews.get(surface)?.owner === owner) { const previous=previews.get(surface)!.value; previews.delete(surface); if(previous!==read().horizontalSpacing[surface])notifySpacing(surface); } };
      return {
        set(value: number) { if (disposed) return; const normalized=NormalizeHorizontalSpacing(value); if(previews.get(surface)?.owner===owner && previews.get(surface)?.value===normalized)return; previews.set(surface,{owner,value:normalized}); notifySpacing(surface); },
        cancel,
        commit(value?: number) { if(disposed)return; const next=value ?? (previews.get(surface)?.owner===owner ? previews.get(surface)!.value : read().horizontalSpacing[surface]); try { saveSpacing(surface,next); } finally { cancel(); } },
        dispose() { if(disposed)return;cancel();disposed=true; },
      };
    },
    getContextAppearance: (view: PresentationView) => ({ ...read().profiles[view].contextAppearance }),
    saveContextAppearance: (view: PresentationView, value: ContextAppearance) => save(view, { ...read().profiles[view], contextAppearance: NormalizeContextAppearance(value) }),
    subscribeContextAppearance: (listener: (view: PresentationView) => void) => { contextAppearanceListeners.add(listener); return () => { contextAppearanceListeners.delete(listener); }; },
    getLayout: (view: PresentationView) => ({ ...read().profiles[view].layout }),
    saveLayout: (view: PresentationView, value: LayoutProfile) => save(view, { ...read().profiles[view], layout: NormalizeLayout(value, DefaultLayouts[view]) }),
    resetLayout: (view: PresentationView, category: LayoutCategory) => {
      const current = { ...read().profiles[view].layout };
      for (const key of LayoutCategories[category]) (current as any)[key] = DefaultLayouts[view][key];
      const surfaces: HorizontalSurface[] = category === "typography" ? view === "NowPlaying" ? ["Card"] : ["Contained", "Fullscreen"] : [];
      for (const surface of surfaces) if(previews.delete(surface))notifySpacing(surface);
      const previous = read();
      const spacing={...previous.horizontalSpacing};for(const surface of surfaces)spacing[surface]=0;
      // Typography and its associated surfaces reset in one persisted payload,
      // so a failed write cannot leave half the reset successfully published.
      save(view, { ...previous.profiles[view], layout: current, contextAppearance: category === "context" ? NormalizeContextAppearance() : previous.profiles[view].contextAppearance },spacing);
    },
    subscribeLayout: (listener: (view: PresentationView, fields: readonly (keyof LayoutProfile)[]) => void) => { layoutListeners.add(listener); return () => { layoutListeners.delete(listener); }; },
    getFontFamily: () => read().fontFamily,
    saveFontFamily: (value: string) => {
      const current = read(), fontFamily = NormalizeFontFamily(value);
      if (futureVersion) throw new Error("Presentation settings require a newer version.");
      if (fontFamily === current.fontFamily) return;
      const updated = { ...current, fontFamily };
      persist(updated);
      for (const listener of familyListeners) listener();
    },
    subscribeFontFamily: (listener: () => void) => { familyListeners.add(listener); return () => { familyListeners.delete(listener); }; },
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
      save(view, { ...current, ...values, layout: current.layout, contextAppearance: current.contextAppearance, conversions: NormalizeConversions(conversions), annotations: NormalizeAnnotations(values.annotations),
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
