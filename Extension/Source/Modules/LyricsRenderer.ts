import type { HorizontalSurface } from "../HorizontalSpacing.ts";
import { EffectiveConversion } from "../AnnotationSettings.ts";
import { ApplyLayoutStyle } from "../LayoutSettings.ts";
import { LyricContext } from "./LyricsRenderer/LyricContext.ts";
import { RegisterTypography, TypographyMeasured } from "./LyricsRenderer/TypographyPreview.ts";
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
        view: PresentationView = "FullLyrics", clock: LyricClock = PlayerLyricClock, counters?: RenderingCounters, options: {surface?: HorizontalSurface; reservation?: HTMLElement} = {}
    ) {
        // Keep the legacy boolean argument position for callers; per-view profile
        // demand now owns alternate text instead of preconverted source fields.
        const lyricDocument = GetLyricDocument(sourceLyrics)
        const availableLanguages = new Set(lyricDocument.groups.flatMap(group => group.voices.map(voice => VoiceLanguage(voice, sourceLyrics.Language))))
        const candidates = DeriveCueCandidates(lyricDocument)
        const gaps = new Map(candidates.map(cue => [cue.start, cue.gapSeconds]))
        const transformedLyrics = { ...ProjectClassic(lyricDocument, candidates), NaturalAlignment: sourceLyrics.NaturalAlignment }
        const bindings = new Map<string, { voice: (typeof lyricDocument.groups)[number]["voices"][number]; base: readonly DisplayRun[]; current: readonly DisplayRun[]; vocal: VocalController }>()
        const bind = (voice: (typeof lyricDocument.groups)[number]["voices"][number], vocal: VocalController, base = LayoutVoice(voice)) => {
            bindings.set(voice.id, { voice, base, current: base, vocal })
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
        const surface=options.surface ?? (view === "NowPlaying" ? "Card" : "Contained")
        lyricsContainer.dataset.horizontalSurface=surface
		scrollContainer.appendChild(lyricsContainer)

		// Now set our natural-alignment
		lyricsContainer.classList.add(`NaturallyAligned${transformedLyrics.NaturalAlignment}`)

        const sourceCase = SourceCaseFor(lyricDocument.precision)
        let rendering = sourceCase ? PresentationSettings.getRendering(view, sourceCase) : { ...ClassicRendering }
        let cueSettings = PresentationSettings.getCues(view)
        let layout = PresentationSettings.getLayout(view)
        ApplyLayoutStyle(lyricsContainer, layout, PresentationSettings.getFontFamily())
        const vocals: VocalController[] = []
        const cues: CueController[] = []
        const vocalGroups: VocalGroups<SyncedVocals> = []
        const visuals = new Map<string, VocalController | CueController>()
        const owners = new Map<string, string>()
        const logicalOwners = new Map<string, number>()
        const cueOwners = new Set<string>()
        const logicalElements = new Map<Element, number>()
        const sourceSlots: { element: HTMLElement; owners: string[] }[] = []
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
                cueOwners.add(id)
                visuals.set(id, cue); addInterval(id, row.StartTime, row.EndTime)
                groupStarts.push(row.StartTime)
            } else {
                const group = lyricDocument.groups[sourceGroupIndex++]
                sourceSlots.push({ element: groupContainer, owners: group.voices.map(voice => voice.id) })
                logicalElements.set(groupContainer,sourceGroupIndex-1)
                if (group.oppositeAligned) groupContainer.classList.add("AlignedOpposite")
                groupStarts.push(Math.min(...group.voices.map(voice => voice.sourceInterval?.start ?? voice.start)))
                for (const voice of group.voices) {
                    const base = LayoutVoice(voice)
                    const vocal = this.Maid.Give(new VocalController(groupContainer, lyricDocument, voice, rendering, counters, base, () => lyricTime()))
                    bind(voice, vocal, base)
                    groupVocals.push(vocal); vocals.push(vocal); visuals.set(voice.id, vocal)
                    logicalOwners.set(voice.id, sourceGroupIndex - 1)
                    if (lyricDocument.type !== "Static") {
                        addInterval(voice.id, voice.start, voice.end)
                        // Discrete segment highlight needs source starts/strict ends
                        // even while the surrounding voice remains active.
                        for (const span of voice.spans) addInterval(voice.id, span.start!, span.end!)
                    }
                }
            }
            vocalGroups.push({ GroupContainer: groupContainer, Vocals: groupVocals, Role: "Type" in row && row.Type === "Interlude" ? "cue" : "source" })
            lyricsContainer.appendChild(groupContainer)
        }
        const updatePrecision = () => {
            lyricsContainer.dataset.effectivePrecision = lyricDocument.type === "Static" ? "static"
                : rendering.detail === "line" ? "line" : lyricDocument.precision
        }
        updatePrecision()
        // Attach before the scroller's first geometry batch. Hidden/collapsed
        // surfaces still defer measurement until their real positive-size resize.
        parentContainer.appendChild(scrollContainer)
        this.Maid.Give(RegisterTypography(view,lyricsContainer,surface))
        const scroller = this.Maid.Give(new LyricsScroller(scrollContainer, lyricsContainer, vocalGroups,
            lyricDocument.type !== "Static", rendering.blur, counters, { profile: layout,
                browsing: () => { updateContext(); scheduler.update(contextTime, 0) }, measured: TypographyMeasured, surface, reservation: options.reservation,
                spacing:()=>PresentationSettings.getEffectiveHorizontalSpacing(surface),
                navigationTargets:()=> { const [start,end]=context.getNavigationSpan();return sourceSlots.slice(start,end+1).map(slot=>slot.element) } }))
        const offsets = () => [TimingSettings.get("Shared"), TimingSettings.get(view)] as const
        let effectiveOffset = TimingSettings.get("Shared") + TimingSettings.get(view)
        const lyricTime = () => clock.now() - effectiveOffset
        const context = new LyricContext(lyricDocument.groups.length, lyricDocument.groups.map(group => Math.min(...group.voices.map(voice => voice.start))),
            lyricDocument.groups.flatMap((group,index)=>group.voices.map(voice=>({index,start:voice.start,end:voice.end}))))
        let activeLogical: readonly number[] = [], contextTime = lyricTime(), contextSeek = true, contextKey = ""
        const updateContext = () => {
            if (lyricDocument.type === "Static") return
            const [start,end] = context.select(activeLogical,contextTime,contextSeek,layout,scroller.IsBrowsing())
            contextSeek = false
            // Segment boundaries normally retain the same source span. Do no
            // all-song writes/visibility allocation until that span changes.
            const focused=logicalElements.get(document.activeElement?.closest(".VocalsGroup")!) ?? -1
            const key=`${start}:${end}:${focused}`
            if(key===contextKey)return
            contextKey=key
            const visible=new Set<string>(cueOwners)
            for(const [index,slot] of sourceSlots.entries()) {
                const shown=index>=start&&index<=end||index===focused
                if(slot.element.classList.contains("ContextExcluded")===shown) {
                    slot.element.classList.toggle("ContextExcluded",!shown)
                    slot.element.inert=!shown
                    if(shown)slot.element.removeAttribute("aria-hidden");else slot.element.setAttribute("aria-hidden","true")
                }
                if(shown)for(const id of slot.owners)visible.add(id)
            }
            scheduler.setVisible(visible)
        }
        const scheduler = new RenderScheduler(visuals, intervals, owners, counters, (active,time,seek) => {
            activeLogical=[...new Set([...active].map(id=>logicalOwners.get(id)).filter((id):id is number=>id!==undefined))]
            contextTime=time;contextSeek=seek;updateContext()
        })
        let clickTarget: number | undefined
        let clickPendingAt = 0
        if (lyricDocument.type !== "Static") {
            let previousTime: number | undefined
            const update = (deltaTime: number, skipped?: true) => {
                const timestamp = lyricTime()
                const clickAcknowledged=clickTarget!==undefined&&Math.abs(timestamp-clickTarget)<.1
                // Spotify's seek returns before its interpolated Timestamp
                // changes. Keep the explicit navigation target until that clock
                // acknowledges it; stale pre-seek ticks must not undo its move.
                // A different real skip or bounded failed-seek window releases
                // the intent without another timer/clock subscription.
                if(clickTarget!==undefined&&!clickAcknowledged&&!skipped&&performance.now()-clickPendingAt<1500)return
                if(clickTarget!==undefined&&(clickAcknowledged||skipped||performance.now()-clickPendingAt>=1500))clickTarget=undefined
                const immediate = skipped || (previousTime !== undefined && timestamp < previousTime) || undefined
                scheduler.update(timestamp, deltaTime, immediate)
                previousTime = timestamp
                scroller.SetLyricsEnded(timestamp >= lyricDocument.end)
                if (immediate) {
                    if (!clickAcknowledged) scroller.ForceToActive()
                }
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
                    clickTarget = groupStarts[index]
                    clickPendingAt=performance.now()
                    clock.seek(TransportTime(groupStarts[index], ...offsets(), clock.duration()))
                    // A paused or same-position seek need not emit a clock skip.
                    // Explicit navigation owns exactly one chosen recenter.
                    scheduler.update(groupStarts[index],0,true)
                    scroller.ForceToActive(true)
                }))
            }
        }
        this.Maid.Give(PresentationSettings.subscribeLayout((changedView,fields) => {
            if(changedView!==view)return
            layout=PresentationSettings.getLayout(view)
            ApplyLayoutStyle(lyricsContainer,layout,PresentationSettings.getFontFamily())
            scroller.SetProfile(layout)
            if(fields.some(field=>["primaryRatio","backingRatio","leadWeight","backingWeight","leading","groupGap"].includes(field))) scroller.RefreshLayout()
            if(fields.some(field=>["before","after","follow"].includes(field))) { contextKey="";updateContext();scheduler.update(contextTime,0) }
        }))
        this.Maid.Give(PresentationSettings.subscribeHorizontalSpacing(changedSurface=> {
            if(changedSurface===surface)scroller.RefreshLayout()
        }))
        this.Maid.Give(PresentationSettings.subscribeFontFamily(() => {
            ApplyLayoutStyle(lyricsContainer,layout,PresentationSettings.getFontFamily());scroller.RefreshLayout()
        }))
        const focusChanged=()=>queueMicrotask(()=>{if(this.Maid.IsDestroyed())return;contextKey="";updateContext();scheduler.update(contextTime,0)})
        scrollContainer.addEventListener("focusout",focusChanged)
        this.Maid.Give(()=>scrollContainer.removeEventListener("focusout",focusChanged))
        this.Maid.Give(PresentationSettings.subscribeRendering((changedView, changedCase, fields) => {
            if (!sourceCase || changedCase !== sourceCase || changedView !== view || fields.every(field => field === "preset")) return
            rendering = PresentationSettings.getRendering(view, sourceCase)
            updatePrecision()
            const time = lyricTime()
            for (const vocal of vocals) vocal.SetRendering(rendering, time)
            if (vocals.some(vocal => vocal.HasAnnotations())) scroller.RefreshAnnotationLayout()
            scroller.SetBlurEnabled(vocals.some(vocal => vocal.HasBlur()))
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

        const leases = new Map<string, { key: string; release: () => void; result?: ReadonlyMap<string, readonly DisplayRun[]> }>()
        let requestKey = ""
        const applyAnnotations = () => {
            const profile = PresentationSettings.getProfile(view)
            let changed = false
            for (const [id, binding] of bindings) {
                const language = VoiceLanguage(binding.voice, sourceLyrics.Language)
                const conversion = EffectiveConversion(profile.conversions, language);
                const projected = conversion ? leases.get(`${language}:${conversion.form}`)?.result?.get(id) : undefined;
                const successful = projected?.some(run => run.AnnotationDerived) ? projected : undefined;
                const runs = conversion?.placement === "replace" && successful ? successful : binding.base;
                if (runs !== binding.current) { binding.current = runs; binding.vocal.SetProjection(runs, lyricTime()); changed = true }
                const secondary = conversion?.placement === "above" ? successful : undefined;
                const ruby = conversion?.placement === "attached" ? successful : undefined;
                changed = binding.vocal.SetAnnotations(profile.annotations, secondary, ruby?.some(run => run.Reading) ? ruby : undefined, lyricTime()) || changed
            }
            scroller.SetBlurEnabled(vocals.some(vocal => vocal.HasBlur()))
            if (changed) { scroller.RefreshAnnotationLayout(); scheduler.refresh() }
        }
        const request = () => {
            const profile = PresentationSettings.getProfile(view)
            const demand = new Map<string, Set<"Chinese" | "Japanese" | "Korean">>()
            const require = (language: "Chinese" | "Japanese" | "Korean", form: "romaji" | "kana") => {
                if (!availableLanguages.has(language)) return
                const key = `${language}:${form}`
                if (!demand.has(key)) demand.set(key, new Set())
                demand.get(key)!.add(language)
            }
            for (const language of ["Chinese", "Japanese", "Korean"] as const) {
                const conversion = EffectiveConversion(profile.conversions, language);
                if (conversion) require(language, conversion.form);
            }
            const key = JSON.stringify([...demand].sort().map(([form, languages]) => [form, [...languages].sort()]))
            if (key === requestKey) { applyAnnotations(); return }
            requestKey = key
            // Reconcile language/form leases independently. A mixed-song language
            // toggle must not cancel another language's unchanged pending job.
            const keys = new Map([...demand].map(([form, languages]) => [form, JSON.stringify([...languages].sort())]))
            for (const [form, entry] of leases) if (entry.key !== keys.get(form)) { entry.release(); leases.delete(form) }
            for (const [form, languages] of demand) {
                if (leases.has(form)) continue
                const lease = AnnotationService.acquire(lyricDocument, { languages: [...languages], japaneseForm: form.split(":")[1] as "romaji" | "kana" }, sourceLyrics.Language)
                const entry = { key: keys.get(form)!, release: lease.release, result: undefined as ReadonlyMap<string, readonly DisplayRun[]> | undefined }
                leases.set(form, entry)
                void lease.promise.then(result => {
                    if (leases.get(form) !== entry || this.Maid.IsDestroyed()) return
                    entry.result = result; applyAnnotations()
                })
            }
            applyAnnotations()
        }
        this.Maid.Give(() => { for (const lease of leases.values()) lease.release(); leases.clear() })
        this.Maid.Give(PresentationSettings.subscribe((changedView, languages) => {
            if (changedView === view && languages.some(language => availableLanguages.has(language))) request()
        }))
        let annotations = PresentationSettings.getAnnotations(view)
        this.Maid.Give(PresentationSettings.subscribeAnnotations(changedView => {
            if (changedView !== view) return
            const next = PresentationSettings.getAnnotations(view)
            const caseChanged = sourceCase && JSON.stringify(next.cases[sourceCase]) !== JSON.stringify(annotations.cases[sourceCase])
            const viewChanged = JSON.stringify({ ...next, cases: undefined }) !== JSON.stringify({ ...annotations, cases: undefined })
            annotations = next
            if (caseChanged || viewChanged) request()
        }))
        request()

		// Now parent our container
		// Container was attached before the first measurement above.
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
