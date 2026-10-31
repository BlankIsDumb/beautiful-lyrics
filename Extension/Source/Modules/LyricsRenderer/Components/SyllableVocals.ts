import { ClassicRendering, ContinuousTextEffects, LetterEmphasis, type RenderingProfile } from "../../../RenderingSettings.ts"
import { ClearDisabledEffects, EffectProperty, ReconcileSprings, type VocalRenderOptions } from "../RenderEffects.ts"
import { LyricTimeline } from "../../LyricTimeline.ts"
import { Graphemes, LayoutSyllables, RunProgress, SourceOwnerKey, VisualProgress, type DisplayRun, type TimingInterval } from "../../TextLayout.ts"
import { timingProgress } from "@Spices/Spicetify/Services/Player/LyricTiming.mjs"
// NPM
import { easeSinOut } from 'npm:d3-ease';

// Packages
import { Maid, Giveable } from '@Universal/Modules/Maid.ts'
import { Signal } from '@Universal/Modules/Signal.ts'
import Spring from '@Universal/Modules/LegacySpring.ts'

// Modules
import { GetSpline, Clamp } from '../SharedMethods.ts';

// Imported Types
import { LiveText, LyricState, SyncedVocals } from '../Types.d.ts'
import { SyllableList, SyllableMetadata } from "@Universal/Types/Lyrics.ts"

// Types
type AnimatedLetter = { // Time is relative to the Syllable
	Start: number;
	Duration: number;
	GlowDuration: number;

	LiveText: LiveText;
}
type AnimatedSyllable = ( // Time is relative to the entire vocal-set
	{
        Intervals: readonly TimingInterval[];
        TimingDuration: number;
        VisualRange?: DisplayRun["VisualRange"];
		Start: number;
		Duration: number;

		StartScale: number;
		DurationScale: number;

		LiveText: LiveText;
	}
	& (
		{
			Type: "Syllable";
		}
		| {
			Type: "Letters";
			Letters: AnimatedLetter[];
		}
	)
)

// Visual Constants
const ScaleRange = [
	{
		Time: 0,
		Value: 0.95
	}, // Lowest
	{
		Time: 0.7,
		Value: 1.025
	}, // Highest
	{
		Time: 1,
		Value: 1
	} // Rest
]
const YOffsetRange = [ // This is relative to the font-size
	{
		Time: 0,
		Value: (1 / 100)
	}, // Lowest
	{
		Time: 0.9,
		Value: -(1 / 60)
	}, // Highest
	{
		Time: 1,
		Value: 0
	} // Rest
]
const GlowRange = [
	{
		Time: 0,
		Value: 0
	}, // Lowest
	{
		Time: 0.15,
		Value: 1
	}, // Highest
	{
		Time: 0.6,
		Value: 1
	}, // Sustain
	{
		Time: 1,
		Value: 0
	} // Rest
]
let ScaleSpline: ReturnType<typeof GetSpline> | undefined
let YOffsetSpline: ReturnType<typeof GetSpline> | undefined
let GlowSpline: ReturnType<typeof GetSpline> | undefined

const YOffsetDamping = 0.4
const YOffsetFrequency = 1.25
const ScaleDamping = 0.6
const ScaleFrequency = 0.7
const GlowDamping = 0.5
const GlowFrequency = 1

const springParameters = { scale: [ScaleDamping, ScaleFrequency], vertical: [YOffsetDamping, YOffsetFrequency], glow: [GlowDamping, GlowFrequency] } as const
// Emphasis Evaluation Constants
const MinimumEmphasizedDuration = 1
const MaximumEmphasizedCharacters = 12
const IsEmphasized = (metadata: DisplayRun) => {
    const owner = metadata.SourceOwners?.length === 1 ? metadata.SourceOwners[0] : undefined
    // Source-selected eligibility survives a different spelling. Truly merged
    // owners have no honest finer cadence and use a complete grouped effect.
    if (metadata.SourceOwners && !owner) return false
    const count = metadata.SafeLetters ? Graphemes(owner?.text ?? metadata.Text).length : 0
    return count > 0 && count <= MaximumEmphasizedCharacters && (owner?.duration ?? metadata.TimingDuration) >= MinimumEmphasizedDuration
}

// Class
export default class SyllableVocals implements SyncedVocals, Giveable {
	// Private Properties
	private readonly Maid: Maid = new Maid()
    private readonly ContentMaid = this.Maid.Give(new Maid())
    private Profile: RenderingProfile
    private Options: VocalRenderOptions
    private Runs: readonly DisplayRun[] = []
    private RunTimeline = new LyricTimeline([])
    private RunOwners: number[] = []
    private ActiveRuns = new Set<number>()
    private SettlingRuns = new Set<number>()
    private RunWork = new Set<number>()
    private LastTime: number | undefined
    private Reconciling = false
    private ProjectionStates = new Map<string, { run: DisplayRun; springs: LiveText["Springs"]; letters: LiveText["Springs"][] }>()

	private readonly Container: HTMLDivElement

	private readonly StartTime: number
	private readonly Duration: number
	private readonly Syllables: AnimatedSyllable[] = []

	private State: LyricState = "Idle"
	private IsSleeping: boolean = true

	private readonly ActivityChangedSignal = this.Maid.Give(new Signal<(isActive: boolean) => void>())
	private readonly RequestedTimeSkipSignal = this.Maid.Give(new Signal<() => void>())

	// Public Properties
	public readonly ActivityChanged = this.ActivityChangedSignal.GetEvent()
	public readonly RequestedTimeSkip = this.RequestedTimeSkipSignal.GetEvent()

	// Constructor
	public constructor(
		lineContainer: HTMLElement,
		syllablesMetadata: SyllableList, isBackground: boolean,
		isRomanized: boolean, initialRuns?: readonly DisplayRun[], options: VocalRenderOptions = {}
	) {
        // Retain the old boolean argument for compatibility. Display text comes
        // from explicit safe runs; provider RomanizedText is no longer mutated.
		// First create our container
		this.Options = options
        this.Profile = { ...(options.profile || ClassicRendering) }
        const container = options.root || this.Maid.Give(document.createElement('div'))
		container.classList.add('Vocals')
		container.classList.add(isBackground ? 'Background' : 'Lead')
		this.Container = container

		// Handle our request time-skip signal
        if (!options.root) {
            const click = () => this.RequestedTimeSkipSignal.Fire()
            container.addEventListener('click', click)
            this.Maid.Give(() => container.removeEventListener('click', click))
        }

		// Define our start/end times
		this.StartTime = Math.min(...syllablesMetadata.map(s => s.StartTime))
		this.Duration = (
			Math.max(...syllablesMetadata.map(s => s.EndTime))
			- this.StartTime
		)

		this.SetProjection(initialRuns || LayoutSyllables(syllablesMetadata))

		// Now set our state
		this.SetToGeneralState(false)

		// Finally, add our vocals to our line
		// A controller owns a supplied root, its parenting and click lifetime.
		if (!options.root) lineContainer.appendChild(container)
	}

    // Only text DOM/springs belong to this replaceable content maid. The vocal
    // container, seek listener, activity signal, source timing and scroll identity
    // survive an asynchronous annotation update. Compatible source-owner effects
    // retain their current position/velocity while the replacement DOM reconciles.
    public SetProjection(runs: readonly DisplayRun[], time = this.LastTime) {
        this.Runs.forEach((run, index) => {
            const old = this.Syllables[index]
            if (old) this.ProjectionStates.set(SourceOwnerKey(run.SourceRanges), {
                run,
                springs: ReconcileSprings(old.LiveText.Springs, this.Profile, springParameters, this.Options.counters),
                letters: LetterEmphasis(this.Profile) && old.Type === "Letters"
                    ? old.Letters.map(letter => ReconcileSprings(letter.LiveText.Springs, this.Profile, springParameters, this.Options.counters)) : [],
            })
        })
        this.Runs = runs
        this.LastTime = undefined
        this.ActiveRuns.clear(); this.SettlingRuns.clear()
        this.ContentMaid.CleanUp()
        this.Syllables.length = 0
        const container = this.Container
		// Go through and create our syllable-groups
		const syllableGroups: DisplayRun[][] = []
		{
			let currentSyllableGroup: DisplayRun[] = []

			for (const syllableMetadata of runs) {
				// Store ourselves
				currentSyllableGroup.push(syllableMetadata)

				// If we aren't part of a word than this means this is either the end of the group or isolated
				if (syllableMetadata.IsPartOfWord === false) {
					syllableGroups.push(currentSyllableGroup)
					currentSyllableGroup = []
				}
			}

			if (currentSyllableGroup.length > 0) {
				syllableGroups.push(currentSyllableGroup)
			}
		}

		// Go through our groups and start building our visuals
		for (const syllableGroup of syllableGroups) {
			// Determine what we are parenting to
			let parentElement: HTMLElement = container
			const syllableCount = syllableGroup.length
			const isInWordGroup = (syllableCount > 1)
			if (isInWordGroup) {
				// Create our parent element
				const parent = this.ContentMaid.Give(document.createElement('span'))
				parent.classList.add('Word')
				parentElement = parent

				// Add our parent to our container
				container.appendChild(parent)
			}

			// Now handle all our syllables
			for (const [index, syllableMetadata] of syllableGroup.entries()) {
                const saved = this.ProjectionStates.get(SourceOwnerKey(syllableMetadata.SourceRanges))
				// Determine if we are emphasised
				const isEmphasized = LetterEmphasis(this.Profile) && IsEmphasized(syllableMetadata)

				// Create our main span element
				const syllableSpan = this.ContentMaid.Give(document.createElement('span'))
				{
					// Add our classes
					syllableSpan.classList.add('Lyric')
					syllableSpan.classList.add('Syllable')
                    if (!syllableMetadata.SafeLetters) syllableSpan.classList.add('ShapingRun')
                    if (syllableMetadata.ExplicitSpacing) syllableSpan.classList.add('ExplicitSpacing')
                    if (syllableMetadata.AnnotationDerived) syllableSpan.classList.add('ConvertedRun')
					if (isEmphasized) {
						syllableSpan.classList.add('Emphasis')
					} else {
						syllableSpan.classList.add('Synced')
					}

					const isEndOfWord = (isInWordGroup && (index === (syllableCount - 1)))
					if (syllableMetadata.IsPartOfWord) {
						syllableSpan.classList.add('PartOfWord')

						if (index === 0) {
							syllableSpan.classList.add('StartOfWord')
						} else if(isEndOfWord) {
							syllableSpan.classList.add('EndOfWord')
						}
					} else if (isEndOfWord) {
						syllableSpan.classList.add('EndOfWord')
					}
				}

				// Determine whether or not our content is a set of letters or a single text
				let letters: (AnimatedLetter[] | undefined)
				if (isEmphasized) {
					// Store all our "letters"
					const letterTexts = Graphemes(syllableMetadata.Text)

					// Now determine our relative timestep
					const relativeTimestep = (1 / letterTexts.length)

					// Now generate our letters
					letters = []
					let relativeTimestamp = 0
					for (const [letterIndex, letter] of letterTexts.entries()) {
						// Create our letter-span
						const letterSpan = this.ContentMaid.Give(document.createElement('span'))
						letterSpan.classList.add('Letter')
						letterSpan.classList.add('Synced')
						letterSpan.innerText = letter
						syllableSpan.appendChild(letterSpan)

						// Now store our letter
                        const sameSlots = saved?.letters.length === letterTexts.length
                        const previous = saved?.letters[Math.min(saved.letters.length - 1, Math.floor(letterIndex * saved.letters.length / letterTexts.length))]
                        const springs = ReconcileSprings(sameSlots ? previous : undefined, this.Profile, springParameters, this.Options.counters)
                        // Different spellings need new visual slots. Copy their
                        // nearest normalized visual state, never acoustic times
                        // and never one shared spring updated twice per frame.
                        if (!sameSlots && springs && previous) for (const key of ["Scale", "YOffset", "Glow"] as const) {
                            if (springs[key] && previous[key]) springs[key]!.CopyStateFrom(previous[key]!)
                        }
						letters.push(
							{
								Start: relativeTimestamp,
								Duration: relativeTimestep,
								GlowDuration: (1 - relativeTimestamp),

								LiveText: {
									Object: letterSpan,
									Springs: springs
								}
							}
						)

						// Now update our relative-timestamp for the next letter
						relativeTimestamp += relativeTimestep
					}
				} else {
					// Update our text
					syllableSpan.innerText = syllableMetadata.Text
				}

				// Determine our time information
				const relativeStart = (syllableMetadata.StartTime - this.StartTime)
				const relativeEnd = (syllableMetadata.EndTime - this.StartTime)

				const relativeStartScale = this.Duration > 0 ? relativeStart / this.Duration : 0
				const relativeEndScale = this.Duration > 0 ? relativeEnd / this.Duration : 0

				const duration = (relativeEnd - relativeStart)
				const durationScale = (relativeEndScale - relativeStartScale)

				// Now determine how we store our information
				const syllableLiveText = {
					Object: syllableSpan,
					Springs: ReconcileSprings(saved?.springs, this.Profile, springParameters, this.Options.counters)
				}
				if (isEmphasized) {
					this.Syllables.push(
						{
							Type: "Letters",
                            Intervals: syllableMetadata.Intervals, TimingDuration: syllableMetadata.TimingDuration,
                            VisualRange: syllableMetadata.VisualRange,

							Start: relativeStart,
							Duration: duration,

							StartScale: relativeStartScale,
							DurationScale: durationScale,

							LiveText: syllableLiveText,

							Letters: letters!
						}
					)
				} else {
					this.Syllables.push(
						{
							Type: "Syllable",
                            Intervals: syllableMetadata.Intervals, TimingDuration: syllableMetadata.TimingDuration,
                            VisualRange: syllableMetadata.VisualRange,

							Start: relativeStart,
							Duration: duration,

							StartScale: relativeStartScale,
							DurationScale: durationScale,

							LiveText: syllableLiveText
						}
					)
				}

				// Now parent our syllable-span
				parentElement.appendChild(syllableSpan)
			}
		}

        this.RunOwners = []
        const intervals: {id:string;start:number;end:number}[] = []
        runs.forEach((run, owner) => run.Intervals.forEach(interval => {
            const id = String(this.RunOwners.length)
            this.RunOwners.push(owner); intervals.push({id,...interval})
        }))
        this.RunTimeline = new LyricTimeline(intervals)
        // Retain only canonical owner states and the currently mounted groups.
        // Arbitrary projection histories must not accumulate detached DOM/state.
        const keep = new Set(runs.flatMap(run => [...(run.SourceOwners || []).map(owner => owner.key), SourceOwnerKey(run.SourceRanges)]))
        for (const key of this.ProjectionStates.keys()) if (!keep.has(key)) this.ProjectionStates.delete(key)
        if (time !== undefined) {
            // Async conversion can arrive before the first playback frame.
            // Initialize replacement glyph CSS at that explicit adjusted clock
            // even when the original voice was already idle and sleeping.
            this.Reconcile(time)
        }
    }

	// Private Methods
	private UpdateLiveTextState = (
		liveText: Pick<LiveText, "Springs">,
		timeScale: number, glowTimeScale: number,
		forceTo?: true
	) => {
        const springs = liveText.Springs
        const target = (spring: NonNullable<LiveText["Springs"]>["Scale"], value: number) => {
            if (!spring) return
            if (forceTo) spring.Set(value); else spring.Final = value
        }
        if (springs?.Scale) target(springs.Scale, (ScaleSpline ??= GetSpline(ScaleRange)).at(timeScale))
        if (springs?.YOffset) target(springs.YOffset, (YOffsetSpline ??= GetSpline(YOffsetRange)).at(timeScale))
        if (springs?.Glow) target(springs.Glow, (GlowSpline ??= GetSpline(GlowRange)).at(glowTimeScale))
    }

    // A genuinely merged token has one honest grouped display clock, but its
    // constituent source owners remain canonical. Advance only their numeric
    // effects while hidden so returning to Original cannot resurrect a stale
    // position/velocity. This is bounded by the active run's own source owners;
    // it performs no DOM work, and disabled effects have no cached resources.
    private AdvanceHiddenOwners(run: DisplayRun, time: number, delta: number, immediate?: true) {
        if (!run.SourceOwners || run.SourceOwners.length < 2) return true
        let sleeping = true
        for (const owner of run.SourceOwners) {
            const state = this.ProjectionStates.get(owner.key)
            if (!state) continue
            const progress = RunProgress(time, state.run.Intervals, state.run.TimingDuration)
            const advance = (springs: LiveText["Springs"], phase: number, glow: number) => {
                if (!springs) return
                this.UpdateLiveTextState({ Springs: springs }, phase, glow, immediate)
                for (const spring of [springs.Scale, springs.YOffset, springs.Glow]) if (spring) {
                    if (this.Options.counters) this.Options.counters.springUpdates++
                    spring.Update(delta)
                    if (!spring.IsSleeping()) sleeping = false
                }
            }
            advance(state.springs, progress, progress)
            const phase = easeSinOut(progress), count = state.letters.length
            state.letters.forEach((springs, index) => {
                const start = index / count
                advance(springs, Clamp((phase - start) * count, 0, 1), Clamp((phase - start) / (1 - start), 0, 1))
            })
        }
        return sleeping
    }

    private UpdateLiveTextVisuals = (liveText: LiveText, isEmphasized: boolean, timeScale: number, deltaTime: number, segmentStarted = timeScale > 0): boolean => {
        const springs = liveText.Springs
        const update = (spring: NonNullable<LiveText["Springs"]>["Scale"]) => {
            if (this.Options.counters) this.Options.counters.springUpdates++
            return spring!.Update(deltaTime)
        }
        const set = (name: string, value: string) => EffectProperty(liveText.Object, name, value, this.Options.counters)
        if (this.Profile.highlight !== "off") {
            const progress = this.Profile.highlight === "segment" ? (segmentStarted ? 1 : 0) : timeScale
            set("--gradient-progress", `${-20 + 120 * progress}%`)
        }
        if (springs?.Scale) set("scale", String(update(springs.Scale)))
        if (springs?.YOffset) set("transform", `translateY(calc(var(--lyrics-size) * ${update(springs.YOffset) * (isEmphasized ? 2 : 1)}))`)
        if (springs?.Glow) {
            const alpha = update(springs.Glow)
            set("--text-shadow-blur-radius", `${4 + 2 * alpha * (isEmphasized ? 3 : 1)}px`)
            set("--text-shadow-opacity", `${alpha * (isEmphasized ? 100 : 35)}%`)
        }
        return (!springs?.Scale || springs.Scale.IsSleeping()) && (!springs?.YOffset || springs.YOffset.IsSleeping()) && (!springs?.Glow || springs.Glow.IsSleeping())
    }

	private EvaluateClassState() {
		const removeClasses = ["Active", "Sung"]
		let classToAdd: (string | undefined)

		if (this.State === "Active") {
			removeClasses.splice(0, 1)
			classToAdd = "Active"
		} else if (this.State == "Sung") {
			removeClasses.splice(1, 1)
			classToAdd = "Sung"
		}

		for (const className of removeClasses) {
			if (this.Container.classList.contains(className)) {
				this.Container.classList.remove(className)
			}
		}

		if (classToAdd !== undefined) {
			this.Container.classList.add(classToAdd)
		}
	}

	private SetToGeneralState(state: boolean) {
		const timeScale = (state ? 1 : 0)

		for (const syllable of this.Syllables) {
			// Set our state and visuals
			this.UpdateLiveTextState(syllable.LiveText, timeScale, timeScale, true)
			this.UpdateLiveTextVisuals(syllable.LiveText, false, timeScale, 0)

			// Now if we have letters update them as well
			if (syllable.Type === "Letters") {
				for (const letter of syllable.Letters) {
					this.UpdateLiveTextState(letter.LiveText, timeScale, timeScale, true)
					this.UpdateLiveTextVisuals(letter.LiveText, true, timeScale, 0)
				}
			}
		}

		this.State = (state ? "Sung" : "Idle")
		this.EvaluateClassState()
	}

	// Public Methods
	public Animate(songTimestamp: number, deltaTime: number, isImmediate?: true) {
		// Determine our relative time elements
		const relativeTime = (songTimestamp - this.StartTime)
		const timeScale = timingProgress(relativeTime, 0, this.Duration)

		// Determine if we should update our visual-states
		const pastStart = (relativeTime >= 0), beforeEnd = (relativeTime <= this.Duration)
		const isActive = (pastStart && beforeEnd)
		const stateNow = (
			isActive ? "Active"
				: pastStart ? "Sung"
					: "Idle"
		)
		const stateChanged = (stateNow != this.State)
		const shouldUpdateVisualState = (stateChanged || isActive || isImmediate || this.Reconciling)

		// Update our state
		if (stateChanged) {
			const oldState = this.State

			this.State = stateNow

			if (this.State !== "Sung") { // We evaluate this once we've stabilized our animation
				this.EvaluateClassState()
			}

			if (oldState === "Active") {
				this.ActivityChangedSignal.Fire(false)
			} else if (isActive) {
				this.ActivityChangedSignal.Fire(true)
			}
		}

		// Determine if we should flip the sleeping flag
		if (shouldUpdateVisualState) {
			this.IsSleeping = false
		}

		// Now determine if we should update anything at all
		const isMoving = (this.IsSleeping === false)
		if (shouldUpdateVisualState || isMoving) {
			let isSleeping = true

            const immediate = isImmediate || (this.LastTime !== undefined && songTimestamp < this.LastTime) || undefined
            this.RunWork.clear()
            if (immediate || this.RunTimeline.isDue(songTimestamp)) {
                const state = this.RunTimeline.evaluate(songTimestamp, immediate)
                this.ActiveRuns.clear()
                for (const id of state.active) this.ActiveRuns.add(this.RunOwners[Number(id)])
                for (const id of state.changed) this.RunWork.add(this.RunOwners[Number(id)])
            }
            if (ContinuousTextEffects(this.Profile)) for (const index of this.ActiveRuns) this.RunWork.add(index)
            for (const index of this.SettlingRuns) this.RunWork.add(index)
            if (this.Reconciling) for (let index = 0; index < this.Syllables.length; index++) this.RunWork.add(index)
            // LegacySpring reports sleep from position error alone, while a
            // nonzero velocity can still move a previously finished run. Classic
            // updated all runs until this whole voice stopped being scheduled.
            // Preserve that visible cadence only for this active/settling voice
            // when real springs exist; spring-free effects retain indexed work.
            if (this.Profile.scale || this.Profile.verticalMotion || this.Profile.glow) {
                for (let index = 0; index < this.Syllables.length; index++) this.RunWork.add(index)
            }

            this.LastTime = songTimestamp
            for (const index of this.RunWork) {
                const syllable = this.Syllables[index]
                let runSleeping = this.AdvanceHiddenOwners(this.Runs[index], songTimestamp, deltaTime, immediate)
                if (!runSleeping) isSleeping = false

				// Determine our time-scale for the syllable
                const ownerTimeScale = RunProgress(songTimestamp, syllable.Intervals, syllable.TimingDuration)
                const syllableTimeScale = VisualProgress(ownerTimeScale, syllable.VisualRange)

				// Handle our letters if we are emphasized
				if (syllable.Type == "Letters") {
					// Determine our timeAlpha
					const timeAlpha = VisualProgress(easeSinOut(ownerTimeScale), syllable.VisualRange)

					// Then update our letters
					for (const letter of syllable.Letters) {
						// Get our time-scales
						const letterTime = (timeAlpha - letter.Start)
						const letterTimeScale = Clamp(
							(letterTime / letter.Duration),
							0, 1
						)
						const glowTimeScale = Clamp(
							(letterTime / letter.GlowDuration),
							0, 1
						)

						// Now handle updating
						if (shouldUpdateVisualState) {
							this.UpdateLiveTextState(
								letter.LiveText,
								letterTimeScale, glowTimeScale,
								immediate
							)
						}

						if (isMoving) {
							const letterIsSleeping = this.UpdateLiveTextVisuals(
								letter.LiveText, true,
								letterTimeScale, deltaTime, relativeTime >= syllable.Start
							)

							if (letterIsSleeping === false) {
								isSleeping = false
                                runSleeping = false
							}
						}
					}
				}

				// Handle our main live-text
				{
					if (shouldUpdateVisualState) {
						this.UpdateLiveTextState(
							syllable.LiveText,
							syllableTimeScale, syllableTimeScale,
								immediate
						)
					}

					if (isMoving) {
						const syllableIsSleeping = this.UpdateLiveTextVisuals(
							syllable.LiveText, false,
							syllableTimeScale, deltaTime, relativeTime >= syllable.Start
						)

						if (syllableIsSleeping === false) {
							isSleeping = false
                                runSleeping = false
						}
					}
				}
                if (runSleeping) this.SettlingRuns.delete(index); else this.SettlingRuns.add(index)

			}

			if (isSleeping) {
				this.IsSleeping = true

				if (isActive === false) {
					this.EvaluateClassState()
				}
			}
		}
	}

    public SetRendering(profile: RenderingProfile) {
        const lettersChanged = LetterEmphasis(profile) !== LetterEmphasis(this.Profile)
        this.Profile = { ...profile }
        for (const state of this.ProjectionStates.values()) {
            state.springs = ReconcileSprings(state.springs, profile, springParameters, this.Options.counters)
            if (!LetterEmphasis(profile)) state.letters = []
            else state.letters = state.letters.map(springs => ReconcileSprings(springs, profile, springParameters, this.Options.counters))
        }
        if (lettersChanged) this.SetProjection(this.Runs)
        else for (const syllable of this.Syllables) {
            const texts = syllable.Type === "Letters" ? [syllable.LiveText, ...syllable.Letters.map(letter => letter.LiveText)] : [syllable.LiveText]
            for (const text of texts) {
                text.Springs = ReconcileSprings(text.Springs, profile, springParameters, this.Options.counters)
                ClearDisabledEffects(text.Object, profile, this.Options.counters)
            }
        }
    }
    public RequiresContinuous() { return ContinuousTextEffects(this.Profile) }
    // Layout/projection edits repaint at a paused clock without pretending that
    // a seek happened. Existing effect position and momentum remain untouched.
    public Reconcile(time: number) {
        this.Reconciling = true
        try { this.Animate(time, 0) } finally { this.Reconciling = false }
    }

	public ForceState(state: boolean) {
		this.SetToGeneralState(state)
	}

	// Scheduler retains this component until its actual Classic springs settle.
	public NeedsFrame(): boolean {
		return !this.IsSleeping
	}

	public IsActive() {
		return (this.State === "Active")
	}

	// The scroller measures the vocal container (not animated character spans).
	public GetScrollTarget() { return { Element: this.Container, StartTime: this.StartTime } }

	public SetBlur(blurDistance: number) {
		this.Container.style.setProperty('--text-blur', `${blurDistance}px`)
	}

	// Deconstructor
	public Destroy() {
		this.ProjectionStates.clear()
		this.Maid.Destroy()
	}
}
