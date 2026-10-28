// Import Types
import { type TransformedLyrics } from "@Spices/Spicetify/Services/Player/mod.ts"

// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { OnPreRender } from "@Universal/Modules/Scheduler.ts"

import { GetLyricDocument, ProjectClassic, DeriveCueCandidates } from "./LyricDocument.ts"
import { TransportTime } from "./LyricTimeline.ts"
import { PlayerLyricClock, type LyricClock } from "./LyricClock.ts"
import { TimingSettings } from "../TimingSettings.ts"
import { PresentationSettings, type PresentationView } from "../PresentationSettings.ts"
import { AnnotationService, VoiceLanguage } from "./AnnotationService.ts"
import { LayoutVoice, type DisplayRun } from "./TextLayout.ts"

// Our Types
import { SyncedVocals } from "./LyricsRenderer/Types.d.ts"

// Our Modules
import { LyricsScroller, VocalGroups } from "./LyricsRenderer/LyricsScroller.ts"

// Our Components
import { VocalController } from "./LyricsRenderer/VocalController.ts"
import { CueController } from "./LyricsRenderer/CueController.ts"
import { RenderScheduler } from "./LyricsRenderer/RenderScheduler.ts"
import { ClassicRendering, SourceCaseFor, type RenderingCounters } from "../RenderingSettings.ts"

// CSS
import "../Stylings/Lyrics.scss"

// Class
export default class LyricsRenderer implements Giveable {
	// Private Properties
	private Maid: Maid = new Maid()

	// Constructor
	constructor(
		parentContainer: HTMLDivElement,
		sourceLyrics: TransformedLyrics, isRomanized: boolean,
        view: PresentationView = "FullLyrics", clock: LyricClock = PlayerLyricClock, counters?: RenderingCounters
    ) {
        // Keep the legacy boolean argument position for callers; per-view profile
        // demand now owns alternate text instead of preconverted source fields.
        const lyricDocument = GetLyricDocument(sourceLyrics)
        const availableLanguages = new Set(lyricDocument.groups.flatMap(group => group.voices.map(voice => VoiceLanguage(voice, sourceLyrics.Language))))
        const candidates = DeriveCueCandidates(lyricDocument)
        const gaps = new Map(candidates.map(cue => [cue.start, cue.gapSeconds]))
        const transformedLyrics = { ...ProjectClassic(lyricDocument, candidates), NaturalAlignment: sourceLyrics.NaturalAlignment }
        const bindings = new Map<string, { base: readonly DisplayRun[]; current: readonly DisplayRun[]; apply: (runs: readonly DisplayRun[]) => void }>()
        const bind = (voice: (typeof lyricDocument.groups)[number]["voices"][number], apply: (runs: readonly DisplayRun[]) => void, base = LayoutVoice(voice)) => {
            bindings.set(voice.id, { base, current: base, apply })
        }
    // Attribution belongs to every rendering surface, including the sidebar.
    if (transformedLyrics.Attribution) {
      const credit=this.Maid.Give(document.createElement('div'));
      credit.className='BL-Attribution';
      const source=transformedLyrics.Attribution.Source;
      credit.textContent=`${({apple_music:'Apple Music',spotify:'Spotify',spicy_lyrics:'Spicy Lyrics'} as Record<string,string>)[source]||source} via Spicy Lyrics`;
      for(const person of transformedLyrics.Attribution.People){
        credit.append(' · ');
        if(person.URL){const link=document.createElement('a');link.href=person.URL;link.textContent=person.Name;link.target='_blank';link.rel='noopener noreferrer';credit.append(link);}
        else credit.append(person.Name);
      }
      parentContainer.append(credit);
    }
		// Create our containers
		const scrollContainer = this.Maid.Give(document.createElement("div"))
		scrollContainer.classList.add("LyricsScrollContainer")
		const lyricsContainer = this.Maid.Give(document.createElement("div"))
		lyricsContainer.classList.add("Lyrics")
		scrollContainer.appendChild(lyricsContainer)

		// Now set our natural-alignment
		lyricsContainer.classList.add(`NaturallyAligned${transformedLyrics.NaturalAlignment}`)

        const sourceCase = SourceCaseFor(lyricDocument.precision)
        let rendering = sourceCase ? PresentationSettings.getRendering(view, sourceCase) : { ...ClassicRendering }
        let cueSettings = PresentationSettings.getCues(view)
        const vocals: VocalController[] = []
        const cues: CueController[] = []
        const vocalGroups: VocalGroups<SyncedVocals> = []
        const visuals = new Map<string, VocalController | CueController>()
        const owners = new Map<string, string>()
        const intervals: { id: string; start: number; end: number }[] = []
        let sourceGroupIndex = 0
        const addInterval = (owner: string, start: number, end: number) => {
            const id = String(intervals.length)
            owners.set(id, owner); intervals.push({ id, start, end })
        }
        const rows = transformedLyrics.Type === "Static" ? transformedLyrics.Lines : transformedLyrics.Content
        const groupStarts: number[] = []
        for (const row of rows) {
            const groupContainer = this.Maid.Give(document.createElement(transformedLyrics.Type === "Static" ? "div" : "button"))
            groupContainer.classList.add("VocalsGroup")
            const groupVocals: (VocalController | CueController)[] = []
            if ("Type" in row && row.Type === "Interlude") {
                const cue = this.Maid.Give(new CueController(groupContainer, row, cueSettings, counters, gaps.get(row.StartTime)))
                groupVocals.push(cue); cues.push(cue)
                const id = `cue/${vocalGroups.length}`
                visuals.set(id, cue); addInterval(id, row.StartTime, row.EndTime)
                groupStarts.push(row.StartTime)
            } else {
                const group = lyricDocument.groups[sourceGroupIndex++]
                if (group.oppositeAligned) groupContainer.classList.add("AlignedOpposite")
                groupStarts.push(Math.min(...group.voices.map(voice => voice.sourceInterval?.start ?? voice.start)))
                for (const voice of group.voices) {
                    const base = LayoutVoice(voice)
                    const vocal = this.Maid.Give(new VocalController(groupContainer, lyricDocument, voice, rendering, counters, base))
                    bind(voice, runs => vocal.SetProjection(runs, lyricTime()), base)
                    groupVocals.push(vocal); vocals.push(vocal); visuals.set(voice.id, vocal)
                    if (lyricDocument.type !== "Static") {
                        addInterval(voice.id, voice.start, voice.end)
                        // Discrete segment highlight needs source starts/strict ends
                        // even while the surrounding voice remains active.
                        for (const span of voice.spans) addInterval(voice.id, span.start!, span.end!)
                    }
                }
            }
            vocalGroups.push({ GroupContainer: groupContainer, Vocals: groupVocals })
            lyricsContainer.appendChild(groupContainer)
        }
        const updatePrecision = () => {
            lyricsContainer.dataset.effectivePrecision = lyricDocument.type === "Static" ? "static"
                : rendering.detail === "line" ? "line" : lyricDocument.precision
        }
        updatePrecision()
        const scroller = this.Maid.Give(new LyricsScroller(scrollContainer, lyricsContainer, vocalGroups,
            lyricDocument.type !== "Static", rendering.blur, counters))
        const offsets = () => [TimingSettings.get("Shared"), TimingSettings.get(view)] as const
        let effectiveOffset = TimingSettings.get("Shared") + TimingSettings.get(view)
        const lyricTime = () => clock.now() - effectiveOffset
        const scheduler = new RenderScheduler(visuals, intervals, owners, counters)
        let justSkippedByVocal = false
        if (lyricDocument.type !== "Static") {
            let previousTime: number | undefined
            const update = (deltaTime: number, skipped?: true) => {
                const timestamp = lyricTime()
                const immediate = skipped || (previousTime !== undefined && timestamp < previousTime) || undefined
                scheduler.update(timestamp, deltaTime, immediate)
                previousTime = timestamp
                scroller.SetLyricsEnded(timestamp >= lyricDocument.end)
                if (immediate) scroller.ForceToActive(justSkippedByVocal || undefined)
                if (skipped && justSkippedByVocal) justSkippedByVocal = false
            }
            this.Maid.Give(clock.subscribe(update))
            this.Maid.Give(TimingSettings.subscribe(scopes => {
                if (!scopes.includes("Shared") && !scopes.includes(view)) return
                const nextOffset = TimingSettings.get("Shared") + TimingSettings.get(view)
                if (nextOffset === effectiveOffset) return
                effectiveOffset = nextOffset; update(0, true)
            }))
            this.Maid.Give(OnPreRender(() => update(1 / 60, true)))
            for (const [index, group] of vocalGroups.entries()) for (const vocal of group.Vocals) {
                this.Maid.Give(vocal.RequestedTimeSkip.Connect(() => {
                    justSkippedByVocal = true
                    clock.seek(TransportTime(groupStarts[index], ...offsets(), clock.duration()))
                }))
            }
        }
        this.Maid.Give(PresentationSettings.subscribeRendering((changedView, changedCase, fields) => {
            if (!sourceCase || changedCase !== sourceCase || changedView !== view || fields.every(field => field === "preset")) return
            rendering = PresentationSettings.getRendering(view, sourceCase)
            updatePrecision()
            const time = lyricTime()
            for (const vocal of vocals) vocal.SetRendering(rendering, time)
            scroller.SetBlurEnabled(rendering.blur)
            scheduler.refresh()
        }))

        this.Maid.Give(PresentationSettings.subscribeCues((changedView) => {
            if (changedView !== view || lyricDocument.type === "Static") return
            cueSettings = PresentationSettings.getCues(view)
            const time = lyricTime()
            for (const cue of cues) cue.SetSettings(cueSettings, time)
            scroller.RefreshCueLayout()
            scheduler.refresh()
        }))

        let generation = 0
        let release: (() => void) | undefined
        const apply = (result?: ReadonlyMap<string, readonly DisplayRun[]>) => {
            for (const [id, binding] of bindings) {
                const runs = result?.get(id) || binding.base
                if (runs === binding.current) continue
                binding.current = runs
                binding.apply(runs)
            }
        }
        const request = () => {
            const current = ++generation
            release?.(); release = undefined
            apply() // Original always remains available while new work is pending.
            const profile = PresentationSettings.getProfile(view)
            const languages = profile.romanizationEnabled ? (["Chinese", "Japanese", "Korean"] as const).filter(language => availableLanguages.has(language) && profile.romanizedLanguages[language]) : []
            if (!languages.length) return
            const lease = AnnotationService.acquire(lyricDocument, { languages, japaneseForm: languages.includes("Japanese") ? profile.japaneseForm : "romaji" }, sourceLyrics.Language)
            release = lease.release
            void lease.promise.then(result => {
                if (current !== generation || this.Maid.IsDestroyed()) return
                apply(result)
            })
        }
        this.Maid.Give(() => { generation++; release?.() })
        this.Maid.Give(PresentationSettings.subscribe((changedView, languages) => {
            if (changedView === view && languages.some(language => availableLanguages.has(language))) request()
        }))
        request()

		// Now parent our container
		parentContainer.appendChild(scrollContainer)
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
