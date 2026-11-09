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

import { GetLyricDocument, ProjectClassic, DeriveCueCandidates, HoldsRichSyncGap } from "./LyricDocument.ts"
import { TransportTime, type TimelineInterval } from "./LyricTimeline.ts"
import { ResolveDetail } from "./RenderProjection.ts"
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
import { AnimationFields, ClassicRendering, SourceCaseFor, type RenderingCounters, type RenderingProfile, type SourceCase } from "../RenderingSettings.ts"

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
        const allGaps = DeriveCueCandidates(lyricDocument)
        const holdLimit = lyricDocument.source?.RichSyncHoldSeconds ?? 0
        const heldGaps = holdLimit > 0 ? allGaps.filter(gap => HoldsRichSyncGap(gap, holdLimit)) : []
        const candidates = heldGaps.length ? allGaps.filter(gap => !HoldsRichSyncGap(gap, holdLimit)) : allGaps
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
        const readRendering = (): RenderingProfile => {
            if (!sourceCase) return { ...ClassicRendering }
            const profile = PresentationSettings.getRendering(view, sourceCase)
            if (sourceCase === "Word" && ResolveDetail(lyricDocument, profile.detail) === "line") {
                // The source's dropdown selects the display. Line supplies the
                // effects, even if a saved Line profile has a different detail.
                return { ...PresentationSettings.getRendering(view, "Line"), detail: "line" }
            }
            return profile
        }
        let rendering = readRendering()
        let cueSettings = PresentationSettings.getCues(view)
        let layout = PresentationSettings.getLayout(view)
        let contextAppearance = PresentationSettings.getContextAppearance(view)
        ApplyLayoutStyle(lyricsContainer, layout, PresentationSettings.getFontFamily())
        const vocals: VocalController[] = []
        const cues: { id: string; visual: CueController }[] = []
        const vocalGroups: VocalGroups<SyncedVocals> = []
        const visuals = new Map<string, VocalController | CueController>()
        const owners = new Map<string, string>()
        const logicalOwners = new Map<string, number>()
        const cueOwners = new Set<string>()
        const logicalElements = new Map<Element, number>()
        const sourceSlots: { element: HTMLElement; owners: string[] }[] = []
        const sourceIntervals: TimelineInterval[] = []
        let sourceGroupIndex = 0
        const addInterval = (owner: string, start: number, end: number) => {
            const id = String(sourceIntervals.length)
            owners.set(id, owner); sourceIntervals.push({ id, start, end })
        }
        const rows = transformedLyrics.Type === "Static" ? transformedLyrics.Lines : transformedLyrics.Content
        const groupStarts: number[] = []
        for (const row of rows) {
            const groupContainer = this.Maid.Give(document.createElement(transformedLyrics.Type === "Static" ? "div" : "button"))
            groupContainer.classList.add("VocalsGroup")
            const groupVocals: (VocalController | CueController)[] = []
            if ("Type" in row && row.Type === "Interlude") {
                const cue = this.Maid.Give(new CueController(groupContainer, row, cueSettings, counters, gaps.get(row.StartTime)))
                groupVocals.push(cue)
                const id = `cue/${vocalGroups.length}`
                cues.push({ id, visual: cue })
                cueOwners.add(id)
                visuals.set(id, cue); owners.set(id, id)
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
            const muted=contextAppearance.mode === "muted"
            const filter=[contextAppearance.blurEnabled && contextAppearance.blur > 0 ? `blur(${contextAppearance.blur}px)` : "",
                contextAppearance.darkeningEnabled && contextAppearance.darkening > 0 ? `brightness(${1-contextAppearance.darkening/100})` : ""].filter(Boolean).join(" ")
            const mutedProperties: Record<string,string> = muted ? {
                "--jel-context-opacity":String(contextAppearance.opacity/100),
                "--jel-context-hover-opacity":String(Math.max(.6,contextAppearance.opacity/100)),
                "--jel-context-filter":filter || "none",
            } : {}
            for(const [index,slot] of sourceSlots.entries()) {
                // Muted focus is paint-only. Hide retains its existing focused-row
                // pin; neither hover nor focus starts excluded timing effects.
                const shown=index>=start&&index<=end || !muted && index===focused
                const paintedMuted=!shown && muted && (contextAppearance.opacity > 0 || index===focused)
                const interactive=shown || paintedMuted
                if(slot.element.classList.contains("ContextExcluded")===shown)slot.element.classList.toggle("ContextExcluded",!shown)
                const wasMuted=slot.element.classList.contains("ContextMuted")
                if(wasMuted!==paintedMuted)slot.element.classList.toggle("ContextMuted",paintedMuted)
                if(slot.element.inert===interactive)slot.element.inert=!interactive
                if(interactive) { if(slot.element.hasAttribute("aria-hidden"))slot.element.removeAttribute("aria-hidden") }
                else if(slot.element.getAttribute("aria-hidden")!=="true")slot.element.setAttribute("aria-hidden","true")
                // Values live on each excluded group, never on an inherited root
                // that would invalidate every timed glyph on source transitions.
                if(paintedMuted || wasMuted) {
                    for(const name of ["--jel-context-opacity","--jel-context-hover-opacity","--jel-context-filter"]) {
                        const value=paintedMuted ? mutedProperties[name] : undefined
                        if(value) { if(slot.element.style.getPropertyValue(name)!==value)slot.element.style.setProperty(name,value) }
                        else if(slot.element.style.getPropertyValue(name))slot.element.style.removeProperty(name)
                    }
                }
                if(shown)for(const id of slot.owners)visible.add(id)
            }
            scheduler.setVisible(visible)
        }
        const timelineIntervals = () => {
            const intervals = [...sourceIntervals]
            for (const { id, visual } of cues) {
                const display = visual.GetDisplayInterval()
                if (display) intervals.push({ id, start: display.StartTime, end: display.EndTime })
            }
            return intervals
        }
        let heldGroup: HTMLElement | undefined
        const updateHold = (time: number) => {
            let next: HTMLElement | undefined
            if (!activeLogical.length) {
                // Called only at existing timeline boundaries and seeks. The
                // hold occupies real silence, so it needs no scheduled effect.
                let lo = 0, hi = heldGaps.length
                while (lo < hi) {
                    const mid = (lo + hi) >>> 1
                    if (heldGaps[mid].start < time) lo = mid + 1
                    else hi = mid
                }
                const gap = heldGaps[lo - 1]
                if (gap && time < gap.nextVocalStart) next = sourceSlots[context.getNavigationSpan()[1]]?.element
            }
            if (heldGroup === next) return
            heldGroup?.classList.remove("RichSyncHold")
            next?.classList.add("RichSyncHold")
            heldGroup = next
        }
        const scheduler = new RenderScheduler(visuals, timelineIntervals(), owners, counters, (active,time,seek) => {
            activeLogical=[...new Set([...active].map(id=>logicalOwners.get(id)).filter((id):id is number=>id!==undefined))]
            contextTime=time;contextSeek=seek;updateContext()
            if (heldGaps.length) updateHold(time)
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
            for (const [index, group] of vocalGroups.entries()) {
                const navigate = () => {
                    clickTarget = groupStarts[index]
                    clickPendingAt=performance.now()
                    clock.seek(TransportTime(groupStarts[index], ...offsets(), clock.duration()))
                    // Paused/asynchronous seeks retain the existing one recenter.
                    scheduler.update(groupStarts[index],0,true)
                    scroller.ForceToActive(true)
                }
                for (const vocal of group.Vocals) this.Maid.Give(vocal.RequestedTimeSkip.Connect(navigate))
                // Native button keyboard/empty-row activation has no child vocal
                // click. A bubbled child activation already navigated exactly once.
                if(group.Role === "source") {
                    const click=(event: MouseEvent)=>{if(event.target===group.GroupContainer && !group.GroupContainer.inert)navigate()}
                    group.GroupContainer.addEventListener("click",click)
                    this.Maid.Give(()=>group.GroupContainer.removeEventListener("click",click))
                }
            }
        }
        this.Maid.Give(PresentationSettings.subscribeContextAppearance(changedView=>{
            if(changedView!==view)return
            contextAppearance=PresentationSettings.getContextAppearance(view)
            contextKey="";updateContext();scheduler.update(contextTime,0)
        }))
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
            if (!sourceCase || changedView !== view) return
            const isAnimationField = (field: keyof RenderingProfile) => AnimationFields.some(animation => animation === field)
            const activeCase = sourceCase === "Word" && rendering.detail === "line" ? "Line" : sourceCase
            if (changedCase !== activeCase && !(changedCase === sourceCase && fields.includes("detail"))) return
            const next = readRendering()
            const effectiveChanges = (Object.keys(next) as (keyof RenderingProfile)[]).filter(field => field !== "preset" && rendering[field] !== next[field])
            rendering = next
            if (!effectiveChanges.length) return
            updatePrecision()
            const time = lyricTime()
            for (const vocal of vocals) vocal.SetRendering(rendering, time)
            if (effectiveChanges.some(field => !isAnimationField(field)) && vocals.some(vocal => vocal.HasAnnotations())) scroller.RefreshAnnotationLayout()
            scroller.SetBlurEnabled(vocals.some(vocal => vocal.HasBlur()))
            scheduler.refresh()
        }))

        this.Maid.Give(PresentationSettings.subscribeCues((changedView) => {
            if (changedView !== view || lyricDocument.type === "Static") return
            cueSettings = PresentationSettings.getCues(view)
            const time = clickTarget ?? lyricTime()
            let intervalsChanged = false
            for (const { visual } of cues) if (visual.SetSettings(cueSettings, time)) intervalsChanged = true
            if (intervalsChanged) {
                scheduler.replaceIntervals(timelineIntervals())
                scheduler.update(time, 0)
            }
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
            const readingCaseChanged = (key: SourceCase) => JSON.stringify(next.cases[key]) !== JSON.stringify(annotations.cases[key])
            // A Word document can switch display in place. Keep both overrides
            // current so its newly created reading layers use the latest settings.
            const caseChanged = sourceCase && (readingCaseChanged(sourceCase) || (sourceCase === "Word" && readingCaseChanged("Line")))
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
