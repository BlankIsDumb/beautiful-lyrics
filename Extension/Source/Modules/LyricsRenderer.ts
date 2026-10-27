// Import Types
import { type TransformedLyrics } from "@Spices/Spicetify/Services/Player/mod.ts"

// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { OnPreRender } from "@Universal/Modules/Scheduler.ts"

import { GetLyricDocument, ProjectClassic } from "./LyricDocument.ts"
import { LyricTimeline, LyricTime, TransportTime } from "./LyricTimeline.ts"
import { PlayerLyricClock, type LyricClock } from "./LyricClock.ts"
import { TimingSettings } from "../TimingSettings.ts"
import { PresentationSettings, type PresentationView } from "../PresentationSettings.ts"
import { AnnotationService, VoiceLanguage } from "./AnnotationService.ts"
import { LayoutVoice, type DisplayRun } from "./TextLayout.ts"

// Our Types
import { BaseVocals, SyncedVocals } from "./LyricsRenderer/Types.d.ts"

// Our Modules
import { LyricsScroller, VocalGroups } from "./LyricsRenderer/LyricsScroller.ts"

// Our Components
import InterludeVisual from "./LyricsRenderer/Components/Interlude.ts"
import StaticVocals from "./LyricsRenderer/Components/StaticVocals.ts"
import LineVocals from "./LyricsRenderer/Components/LineVocals.ts"
import SyllableVocals from "./LyricsRenderer/Components/SyllableVocals.ts"

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
        view: PresentationView = "FullLyrics", clock: LyricClock = PlayerLyricClock
    ) {
        // Keep the legacy boolean argument position for callers; per-view profile
        // demand now owns alternate text instead of preconverted source fields.
        const lyricDocument = GetLyricDocument(sourceLyrics)
        const availableLanguages = new Set(lyricDocument.groups.flatMap(group => group.voices.map(voice => VoiceLanguage(voice, sourceLyrics.Language))))
        const transformedLyrics = { ...ProjectClassic(lyricDocument), NaturalAlignment: sourceLyrics.NaturalAlignment }
        const bindings = new Map<string, { base: readonly DisplayRun[]; current: readonly DisplayRun[]; apply: (runs: readonly DisplayRun[]) => void }>()
        const bind = (voice: (typeof lyricDocument.groups)[number]["voices"][number], apply: (runs: readonly DisplayRun[]) => void, base = LayoutVoice(voice)) => {
            bindings.set(voice.id, { base, current: base, apply })
        }
        const snap = (vocal: SyncedVocals) => {
            // This is a local text refresh, not a seek. Preserve manual-scroll
            // grace; the existing ResizeObserver remeasures new text geometry.
            vocal.Animate(LyricTime(clock.now(), TimingSettings.get("Shared"), TimingSettings.get(view)), 0, true)
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

		// Now handle creating our vocals
		if (transformedLyrics.Type === "Static") {
			// Populate our lines (not technically VocalGroups since we're static)
			const lines: VocalGroups<BaseVocals> = []
			for (const [groupIndex, line] of transformedLyrics.Lines.entries()) {
				// Create our container
				const lineContainer = this.Maid.Give(document.createElement("div"))
				lineContainer.classList.add("VocalsGroup")

                const vocal = this.Maid.Give(new StaticVocals(lineContainer, line, false))
                bind(lyricDocument.groups[groupIndex].voices[0], runs => vocal.SetText(runs.map(run => run.Text).join("")))
                lines.push({ GroupContainer: lineContainer, Vocals: [vocal] })

				// Parent our container
				lyricsContainer.appendChild(lineContainer)
			}

			// Create our scroller
			this.Maid.Give(new LyricsScroller(scrollContainer, lyricsContainer, lines, false))
		} else {
			// Store our vocal-groups
			const vocalGroups: VocalGroups<SyncedVocals> = []
			const vocalGroupStartTimes: number[] = []
            let sourceGroupIndex = 0

			// Now populate our vocal-groups based on our type
			if (transformedLyrics.Type === "Line") {
				for (const vocalGroup of transformedLyrics.Content) {
					// Create our container
					const vocalGroupContainer = this.Maid.Give(document.createElement("button"))
					vocalGroupContainer.classList.add("VocalsGroup")

					// Determine our how we populate/manipulate this container
					if (vocalGroup.Type === "Vocal") {
						// Add our alignment
						if (vocalGroup.OppositeAligned) {
							vocalGroupContainer.classList.add("AlignedOpposite")
						}

                        const vocal = this.Maid.Give(new LineVocals(vocalGroupContainer, vocalGroup, false))
                        bind(lyricDocument.groups[sourceGroupIndex++].voices[0], runs => { vocal.SetText(runs.map(run => run.Text).join("")); snap(vocal) })
                        vocalGroups.push({ GroupContainer: vocalGroupContainer, Vocals: [vocal] })

						vocalGroupStartTimes.push(vocalGroup.StartTime)
					} else {
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: [this.Maid.Give(new InterludeVisual(vocalGroupContainer, vocalGroup))]
							}
						)
						vocalGroupStartTimes.push(vocalGroup.StartTime)
					}

					// Parent our container
					lyricsContainer.appendChild(vocalGroupContainer)
				}
			} else {
				for (const vocalGroup of transformedLyrics.Content) {
					// Create our container
					const vocalGroupContainer = this.Maid.Give(document.createElement("button"))
					vocalGroupContainer.classList.add("VocalsGroup")

					// Determine our how we populate/manipulate this container
					if (vocalGroup.Type === "Vocal") {
						// Add our alignment
						if (vocalGroup.OppositeAligned) {
							vocalGroupContainer.classList.add("AlignedOpposite")
						}

                        const vocals: SyllableVocals[] = []
                        const originals = lyricDocument.groups[sourceGroupIndex++].voices
                        const parts = [vocalGroup.Lead, ...(vocalGroup.Background || [])]
                        let startTime = Math.min(...parts.map(part => part.StartTime))
                        parts.forEach((part, index) => {
                            const base = LayoutVoice(originals[index])
                            const vocal = this.Maid.Give(new SyllableVocals(vocalGroupContainer, part.Syllables, index > 0, false, base))
                            bind(originals[index], runs => { vocal.SetProjection(runs); snap(vocal) }, base)
                            vocals.push(vocal)
                        })

						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: vocals
							}
						)
						vocalGroupStartTimes.push(startTime)
					} else {
						vocalGroups.push(
							{
								GroupContainer: vocalGroupContainer,
								Vocals: [this.Maid.Give(new InterludeVisual(vocalGroupContainer, vocalGroup))]
							}
						)
						vocalGroupStartTimes.push(vocalGroup.StartTime)
					}

					// Parent our container
					lyricsContainer.appendChild(vocalGroupContainer)
				}
			}

			// Now create our scroller
			const scroller = this.Maid.Give(
				new LyricsScroller(
					scrollContainer, lyricsContainer,
					vocalGroups, true
				)
			)
			
			// Stable component IDs refer to this one immutable projection. Only index
            // boundaries, active voices and genuinely settling springs run each frame.
            const visuals = new Map<string, SyncedVocals>()
            const intervals: { id: string; start: number; end: number }[] = []
            for (const [groupIndex, group] of vocalGroups.entries()) {
                const row = transformedLyrics.Content[groupIndex]
                group.Vocals.forEach((vocal, voiceIndex) => {
                    const id = `${groupIndex}/${voiceIndex}`
                    visuals.set(id, vocal)
                    if (row.Type === "Vocal" && "Lead" in row) {
                        const spans = [row.Lead, ...(row.Background || [])][voiceIndex].Syllables
                        intervals.push({ id, start: Math.min(...spans.map(span => span.StartTime)),
                            end: Math.max(...spans.map(span => span.EndTime)) })
                    } else {
                        intervals.push({ id, start: row.StartTime, end: row.EndTime })
                    }
                })
            }
            const timeline = new LyricTimeline(intervals)
            const settling = new Set<string>()
            let previousTime: number | undefined
            let justSkippedByVocal = false
            const offsets = () => [TimingSettings.get("Shared"), TimingSettings.get(view)] as const
            let effectiveOffset = offsets().reduce((sum, value) => sum + value, 0)
            const update = (deltaTime: number, skipped?: true) => {
                const [shared, local] = offsets()
                const timestamp = LyricTime(clock.now(), shared, local)
                // Clock discontinuities and offset changes must snap inactive
                // components too; normal forward frames never sweep the song.
                const immediate = skipped || (previousTime !== undefined && timestamp < previousTime) || undefined
                const state = timeline.evaluate(timestamp, immediate)
                const work = new Set([...state.changed, ...state.active, ...settling])
                for (const id of work) {
                    const vocal = visuals.get(id)!
                    vocal.Animate(timestamp, deltaTime, immediate)
                    if (vocal.NeedsFrame()) settling.add(id)
                    else settling.delete(id)
                }
                previousTime = timestamp
                scroller.SetLyricsEnded(timestamp >= lyricDocument.end)
                if (immediate) scroller.ForceToActive(justSkippedByVocal || undefined)
                if (skipped && justSkippedByVocal) justSkippedByVocal = false
            }
            this.Maid.Give(clock.subscribe(update))
            this.Maid.Give(TimingSettings.subscribe(scopes => {
                if (!scopes.includes("Shared") && !scopes.includes(view)) return
                const nextOffset = offsets().reduce((sum, value) => sum + value, 0)
                if (nextOffset === effectiveOffset) return
                effectiveOffset = nextOffset
                update(0, true)
            }))
            this.Maid.Give(OnPreRender(() => update(1 / 60, true)))

			// Handle time-skipping
			for (const [index, vocalGroup] of vocalGroups.entries()) {
				const startTime = vocalGroupStartTimes[index]
				
				for (const vocal of vocalGroup.Vocals) {
					vocal.RequestedTimeSkip.Connect(
						() => {
							justSkippedByVocal = true
							const [shared, local] = offsets()
							clock.seek(TransportTime(startTime, shared, local, clock.duration()))
						}
					)
				}
			}
		}

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
