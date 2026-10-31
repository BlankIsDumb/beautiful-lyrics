import { ClassicRendering, type RenderingProfile } from "../../../RenderingSettings.ts"
import { ClearDisabledEffects, EffectProperty, TrackedSpring, type VocalRenderOptions } from "../RenderEffects.ts"
import { RunProgress, VisualProgress, type DisplayRun } from "../../TextLayout.ts"
import { timingProgress } from "@Spices/Spicetify/Services/Player/LyricTiming.mjs"
// Packages
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { Signal } from "@Universal/Modules/Signal.ts"
import Spring from "@Universal/Modules/LegacySpring.ts"

// Modules
import { GetSpline, Clamp } from "../SharedMethods.ts"

// Imported Types
import { SyncedVocals, LyricState } from "../Types.d.ts"
import { LineVocal } from "@Universal/Types/Lyrics.ts"

// Visual Constants
const GlowRange = [
	{
		Time: 0,
		Value: 0
	}, // Lowest
	{
		Time: 0.5,
		Value: 1
	}, // Highest
	{
		Time: 0.925,
		Value: 1
	}, // Sustain
	{
		Time: 1,
		Value: 0
	} // Rest
]
let GlowSpline: ReturnType<typeof GetSpline> | undefined

const GlowDamping = 0.5
const GlowFrequency = 1

// Class
export default class LineVocals implements SyncedVocals, Giveable {
	// Private Properties
	private readonly Maid: Maid = new Maid()

	private readonly Container: HTMLDivElement

	private readonly StartTime: number
	private readonly Duration: number

	private readonly Span: HTMLSpanElement;
	private GlowSpring?: Spring;
    private Profile: RenderingProfile;
    private Options: VocalRenderOptions;
    private Projection?: DisplayRun;
    private Reconciling = false;

	private State: LyricState = "Idle"
	private IsSleeping: boolean = true

	private readonly ActivityChangedSignal = this.Maid.Give(new Signal<(isActive: boolean) => void>())
	private readonly RequestedTimeSkipSignal = this.Maid.Give(new Signal<() => void>())

	// Public Properties
	public readonly ActivityChanged = this.ActivityChangedSignal.GetEvent()
	public readonly RequestedTimeSkip = this.RequestedTimeSkipSignal.GetEvent()

	// Constructor
	public constructor(
		lineContainer: HTMLElement, lineMetadata: LineVocal,
		isRomanized: boolean, options: VocalRenderOptions = {}, projection?: DisplayRun
	) {
		// First create our container
		this.Options = options
        this.Profile = { ...(options.profile || ClassicRendering) }
        this.Projection = projection
        const container = options.root || this.Maid.Give(document.createElement('div'))
		container.classList.add('Vocals')
		if (!options.root) container.classList.add('Lead')
		this.Container = container

		// Handle our request time-skip signal
        if (!options.root) {
            const click = () => this.RequestedTimeSkipSignal.Fire()
            container.addEventListener('click', click)
            this.Maid.Give(() => container.removeEventListener('click', click))
        }

		// Define our start/end times
		this.StartTime = lineMetadata.StartTime
		this.Duration = (lineMetadata.EndTime - lineMetadata.StartTime)

		// Create our main span element
		const syllableSpan = this.Maid.Give(document.createElement('span'))
		syllableSpan.classList.add('Lyric')
		syllableSpan.classList.add('Synced')
		syllableSpan.classList.add('Line')
		syllableSpan.innerText = (isRomanized && lineMetadata.RomanizedText || lineMetadata.Text)
		container.appendChild(syllableSpan)

		// Now create our live-text element
		this.Span = syllableSpan
		this.GlowSpring = this.Profile.glow ? TrackedSpring(0, GlowDamping, GlowFrequency, options.counters) : undefined

		// Now set our state
		this.SetToGeneralState(false)

		// Finally, add our vocals to our line
		// A controller owns a supplied root, its parenting and click lifetime.
		if (!options.root) lineContainer.appendChild(container)
	}

	// Private Methods
	private UpdateLiveTextState = (timeScale: number, forceTo?: true) => {
		// Grab our values
		if (!this.GlowSpring) return
		const glowAlpha = (GlowSpline ??= GetSpline(GlowRange)).at(timeScale)

		// Apply them
		if (forceTo) {
			this.GlowSpring.Set(glowAlpha)
		} else {
			this.GlowSpring.Final = glowAlpha
		}
	}

	private UpdateLiveTextVisuals = (timeScale: number, deltaTime: number): boolean => {
        if (this.GlowSpring) {
            if (this.Options.counters) this.Options.counters.springUpdates++
            const glowAlpha = this.GlowSpring.Update(deltaTime)
            EffectProperty(this.Span, "--text-shadow-blur-radius", `${4 + 8 * glowAlpha}px`, this.Options.counters)
            EffectProperty(this.Span, "--text-shadow-opacity", `${glowAlpha * 50}%`, this.Options.counters)
        }
        if (this.Profile.highlight !== "off") {
            const progress = this.Profile.highlight === "segment" ? (this.State === "Idle" ? 0 : 1) : timeScale
            EffectProperty(this.Span, "--gradient-progress", `${120 * progress}%`, this.Options.counters)
        }
        return !this.GlowSpring || this.GlowSpring.IsSleeping()
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

		this.UpdateLiveTextState(timeScale, true)
		this.UpdateLiveTextVisuals(timeScale, 0)

		this.State = (state ? "Sung" : "Idle")
		this.EvaluateClassState()
	}

	// Public Methods
	public Animate(songTimestamp: number, deltaTime: number, isImmediate?: true) {
		// Determine our relative time elements
		const relativeTime = (songTimestamp - this.StartTime)
		const timeScale = this.Projection ? VisualProgress(RunProgress(songTimestamp, this.Projection.Intervals, this.Projection.TimingDuration), this.Projection.VisualRange) : timingProgress(relativeTime, 0, this.Duration)

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

		// Now determine if we should update anything at all
		if (shouldUpdateVisualState) {
			// Flip the sleeping flag as we just changed something
			this.IsSleeping = false

			// Update our live-text state
			this.UpdateLiveTextState(timeScale, (isImmediate || (relativeTime < 0) || undefined))
		}

		if (this.IsSleeping === false) {
			const isSleeping = this.UpdateLiveTextVisuals(timeScale, deltaTime)

			if (isSleeping) {
				this.IsSleeping = true

				if (isActive === false) {
					this.EvaluateClassState()
				}
			}
		}
	}

    public SetText(text: string, projection?: DisplayRun) { this.Span.innerText = text; this.Projection = projection }
    public SetRendering(profile: RenderingProfile) {
        this.Profile = { ...profile }
        if (!profile.glow) this.GlowSpring = undefined
        else this.GlowSpring ??= TrackedSpring(0, GlowDamping, GlowFrequency, this.Options.counters)
        ClearDisabledEffects(this.Span, profile, this.Options.counters)
    }
    public RequiresContinuous() { return this.Profile.highlight === "classic" || this.Profile.highlight === "progressive" || this.Profile.glow }
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

	public SetBlur(blurDistance: number) {
		this.Container.style.setProperty('--text-blur', `${blurDistance}px`)
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
