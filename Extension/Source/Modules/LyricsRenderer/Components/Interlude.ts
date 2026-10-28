import { EffectProperty, TrackedSpring, type VocalRenderOptions } from "../RenderEffects.ts"
import type { RenderingCounters } from "../../../RenderingSettings.ts"
// NPM
import { CurveInterpolator } from "npm:curve-interpolator"
import { easeSinOut } from "npm:d3-ease"

// Packages
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { Signal } from "@Universal/Modules/Signal.ts"
import Spring from "@Universal/Modules/LegacySpring.ts"

// Modules
import { GetSpline, Clamp } from "../SharedMethods.ts"

// Imported Types
import { SyncedVocals, LyricState } from "../Types.d.ts"
import { Interlude } from "@Universal/Types/Lyrics.ts"

// Types
type DotSprings = {
	Scale: Spring;
	YOffset: Spring;
	Glow: Spring;
	Opacity: Spring;
}
type DotLiveText = {
	Object: HTMLSpanElement;
	Springs: DotSprings;
}

type MainSprings = {
	Scale: Spring;
	YOffset: Spring;
	Opacity: Spring;
}
type MainLiveText = {
	Object: HTMLSpanElement;
	Springs: MainSprings;
}

type AnimatedDot = { // Time is relative to the Syllable
	Start: number;
	Duration: number;
	GlowDuration: number;

	LiveText: DotLiveText;
}

// Visual Constants
const DotCount = 3

const DotAnimations = {
	YOffsetDamping: 0.4,
	YOffsetFrequency: 1.25,
	ScaleDamping: 0.6,
	ScaleFrequency: 0.7,
	GlowDamping: 0.5,
	GlowFrequency: 1,

	ScaleRange: [
		{
			Time: 0,
			Value: 0.75
		}, // Lowest
		{
			Time: 0.7,
			Value: 1.05
		}, // Highest
		{
			Time: 1,
			Value: 1
		} // Rest
	],
	YOffsetRange: [ // This is relative to the font-size
		{
			Time: 0,
			Value: 0.125
		}, // Lowest
		{
			Time: 0.9,
			Value: -0.2
		}, // Highest
		{
			Time: 1,
			Value: 0
		} // Rest
	],
	GlowRange: [
		{
			Time: 0,
			Value: 0
		}, // Lowest
		{
			Time: 0.6,
			Value: 1
		}, // Highest
		{
			Time: 1,
			Value: 1
		} // Rest
	],
	OpacityRange: [
		{
			Time: 0,
			Value: 0.35
		}, // Lowest
		{
			Time: 0.6,
			Value: 1
		}, // Highest
		{
			Time: 1,
			Value: 1
		} // Rest
	]
}
let DotSplines: { ScaleSpline: ReturnType<typeof GetSpline>; YOffsetSpline: ReturnType<typeof GetSpline>; GlowSpline: ReturnType<typeof GetSpline>; OpacitySpline: ReturnType<typeof GetSpline> } | undefined
const GetDotSplines = () => DotSplines ??= {
	ScaleSpline: GetSpline(DotAnimations.ScaleRange),
	YOffsetSpline: GetSpline(DotAnimations.YOffsetRange),
	GlowSpline: GetSpline(DotAnimations.GlowRange),
	OpacitySpline: GetSpline(DotAnimations.OpacityRange)
}
const CreateDotSprings = (counters?: RenderingCounters) => {
	return {
		Scale: TrackedSpring(0, DotAnimations.ScaleDamping, DotAnimations.ScaleFrequency, counters),
		YOffset: TrackedSpring(0, DotAnimations.YOffsetDamping, DotAnimations.YOffsetFrequency, counters),
		Glow: TrackedSpring(0, DotAnimations.GlowDamping, DotAnimations.GlowFrequency, counters),
		Opacity: TrackedSpring(0, DotAnimations.GlowDamping, DotAnimations.GlowFrequency, counters)
	}
}

const MainAnimations = {
	YOffsetDamping: 0.4,
	YOffsetFrequency: 1.25,
	ScaleDamping: 0.7, // 0.6
	ScaleFrequency: 5, // 4

	BaseScaleRange: [ // Time is actually real-time (so in seconds)
		{
			Time: 0,
			Value: 0
		},
		{
			Time: 0.2,
			Value: 1.05
		},
		{
			Time: -0.075,
			Value: 1.15
		},
		{
			Time: -0,
			Value: 0
		} // Rest
	],
	OpacityRange: [
		{
			Time: 0,
			Value: 0
		},
		{
			Time: 0.5,
			Value: 1
		},
		{
			Time: -0.075,
			Value: 1
		},
		{
			Time: -0,
			Value: 0
		} // Rest
	],
	YOffsetRange: [ // This is relative to the font-size
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
}
const PulseInterval = 2.25 // Every X seconds
const DownPulse = 0.95
const UpPulse = 1.05
let MainYOffsetSpline: CurveInterpolator | undefined
const GetMainYOffsetSpline = () => MainYOffsetSpline ??= new CurveInterpolator(
	MainAnimations.YOffsetRange.map((metadata) => [metadata.Time, metadata.Value])
)
const CreateMainSprings = (counters?: RenderingCounters) => {
	return {
		Scale: TrackedSpring(0, MainAnimations.ScaleDamping, MainAnimations.ScaleFrequency, counters),
		YOffset: TrackedSpring(0, MainAnimations.YOffsetDamping, MainAnimations.YOffsetFrequency, counters),
		Opacity: TrackedSpring(0, MainAnimations.YOffsetDamping, MainAnimations.YOffsetFrequency, counters)
	}
}

// Class
export default class InterludeVisual implements SyncedVocals, Giveable {
	// Private Properties
	private readonly Maid: Maid = new Maid()
    private Options: VocalRenderOptions

	private readonly Container: HTMLDivElement

	private readonly StartTime: number
	private readonly Duration: number
	private readonly Dots: AnimatedDot[] = []
	private readonly LiveText: MainLiveText
	private readonly ScaleSpline: CurveInterpolator
	private readonly OpacitySpline: CurveInterpolator

	private State: LyricState = "Idle"
	private IsSleeping: boolean = true

	private readonly ActivityChangedSignal = this.Maid.Give(new Signal<(isActive: boolean) => void>())
	private readonly RequestedTimeSkipSignal = this.Maid.Give(new Signal<() => void>())

	// Public Properties
	public readonly ActivityChanged = this.ActivityChangedSignal.GetEvent()
	public readonly RequestedTimeSkip = this.RequestedTimeSkipSignal.GetEvent()

	// Constructor
	public constructor(lineContainer: HTMLElement, interludeMetadata: Interlude, options: VocalRenderOptions = {}) {
		// First create our container
		this.Options = options
        const container = options.root || this.Maid.Give(document.createElement('div'))
		container.classList.add('Interlude')
		this.Container = container

		// Create our LiveText
		this.LiveText = {
			Object: container,
			Springs: CreateMainSprings(options.counters)
		}

		// Define our start/end times
		this.StartTime = interludeMetadata.StartTime
		this.Duration = (
			interludeMetadata.EndTime
			- this.StartTime
		)

		// Create our splines
		{
			// Clone our ranges
			const scaleRange = MainAnimations.BaseScaleRange.map(
				(point) => {
					return {
						Time: point.Time,
						Value: point.Value
					}
				}
			)
			const opacityRange = MainAnimations.OpacityRange.map(
				(point) => {
					return {
						Time: point.Time,
						Value: point.Value
					}
				}
			)

			// Update our known items
			scaleRange[2].Time += this.Duration
			opacityRange[2].Time += this.Duration
			scaleRange[3].Time = this.Duration
			opacityRange[3].Time = this.Duration

			// Now populate the items between our scale
			{
				const startPoint = scaleRange[1]
				const endPoint = scaleRange[2]
		
				const deltaTime = (endPoint.Time - startPoint.Time)
		
				for (let iteration = Math.floor(deltaTime / PulseInterval); iteration > 0; iteration -= 1) {
					const time = (startPoint.Time + (iteration * PulseInterval))
					const value = ((iteration % 2 === 0) ? UpPulse : DownPulse)
		
					scaleRange.splice(
						2, 0,
						{
							Time: time,
							Value: value
						}
					)
				}
			}

			// Normalize our times
			for (const range of [scaleRange, opacityRange]) {
				for (const point of range) {
					point.Time /= this.Duration
				}
			}

			// Now create our splines
			this.ScaleSpline = new CurveInterpolator(
				scaleRange.map((metadata) => [metadata.Time, metadata.Value])
			)
			this.OpacitySpline = new CurveInterpolator(
				opacityRange.map((metadata) => [metadata.Time, metadata.Value])
			)
		}

		// Go through and create all our dots
		{
			const dotStep = (0.925 / DotCount)
			let startTime = 0

			for (let i = 0; i < DotCount; i++) {
				// Create our main span element
				const syllableSpan = this.Maid.Give(document.createElement('span'))
				syllableSpan.classList.add("InterludeDot")

				// Store our dot
				this.Dots.push(
					{
						Start: startTime,
						Duration: dotStep,
						GlowDuration: (1 - startTime),

						LiveText: {
							Object: syllableSpan,
							Springs: CreateDotSprings(options.counters)
						}
					}
				)

				// Add our dot to our container
				container.appendChild(syllableSpan)

				// Add to our start-time
				startTime += dotStep
			}
		}

		// Now set our state
		this.SetToGeneralState(false)

		// Finally, add our vocals to our line
		// A controller owns a supplied root, its parenting and click lifetime.
		if (!options.root) lineContainer.appendChild(container)
	}

    private UpdateSpring(spring: Spring, delta: number) {
        if (this.Options.counters) this.Options.counters.springUpdates++
        return spring.Update(delta)
    }

	// Private Methods
	private UpdateLiveDotState = (
		liveText: DotLiveText,
		timeScale: number, glowTimeScale: number,
		forceTo?: true
	) => {
		// Grab our values
		const scale = GetDotSplines().ScaleSpline.at(timeScale)
		const yOffset = GetDotSplines().YOffsetSpline.at(timeScale)
		const glowAlpha = GetDotSplines().GlowSpline.at(glowTimeScale)
		const opacity = GetDotSplines().OpacitySpline.at(timeScale)

		// Apply them
		if (forceTo) {
			liveText.Springs.Scale.Set(scale)
			liveText.Springs.YOffset.Set(yOffset)
			liveText.Springs.Glow.Set(glowAlpha)
			liveText.Springs.Opacity.Set(opacity)
		} else {
			liveText.Springs.Scale.Final = scale
			liveText.Springs.YOffset.Final = yOffset
			liveText.Springs.Glow.Final = glowAlpha
			liveText.Springs.Opacity.Final = opacity
		}
	}

	private UpdateLiveDotVisuals = (
		liveText: DotLiveText,
		deltaTime: number
	): boolean => {
		// Update our springs
		const scale = this.UpdateSpring(liveText.Springs.Scale, deltaTime)
		const yOffset = this.UpdateSpring(liveText.Springs.YOffset, deltaTime)
		const glowAlpha = this.UpdateSpring(liveText.Springs.Glow, deltaTime)
		const opacity = this.UpdateSpring(liveText.Springs.Opacity, deltaTime)

		// Now update our objects
		EffectProperty(liveText.Object, "transform", `translateY(calc(var(--dot-size) * ${yOffset}))`, this.Options.counters)
		EffectProperty(liveText.Object, "scale", scale.toString(), this.Options.counters)
		EffectProperty(liveText.Object, "--text-shadow-blur-radius", `${4 + (6 * glowAlpha)}px`, this.Options.counters)
		EffectProperty(liveText.Object, "--text-shadow-opacity", `${glowAlpha * 90}%`, this.Options.counters)
		EffectProperty(liveText.Object, "opacity", opacity.toString(), this.Options.counters)

		// Determine if we are finally asleep or not
		return (
			liveText.Springs.Scale.IsSleeping()
			&& liveText.Springs.YOffset.IsSleeping()
			&& liveText.Springs.Glow.IsSleeping()
			&& liveText.Springs.Opacity.IsSleeping()
		)
	}

	private UpdateLiveMainState = (
		liveText: MainLiveText,
		timeScale: number,
		forceTo?: true
	) => {
		// Grab easy values
		const yOffset = GetMainYOffsetSpline().getPointAt(timeScale)[1]

		// Find our scale/opacity points
		const scaleIntersections = (this.ScaleSpline.getIntersects(timeScale) as number[][])
		const opacityIntersections = (this.OpacitySpline.getIntersects(timeScale) as number[][])
		const scale = (
			(scaleIntersections.length === 0) ? 1
			: scaleIntersections[scaleIntersections.length - 1][1]
		)
		const opacity = (
			(opacityIntersections.length === 0) ? 1
			: opacityIntersections[opacityIntersections.length - 1][1]
		)

		// Apply them
		if (forceTo) {
			liveText.Springs.Scale.Set(scale)
			liveText.Springs.YOffset.Set(yOffset)
			liveText.Springs.Opacity.Set(opacity)
		} else {
			liveText.Springs.Scale.Final = scale
			liveText.Springs.YOffset.Final = yOffset
			liveText.Springs.Opacity.Final = opacity
		}
	}

	private UpdateLiveMainVisuals = (
		liveText: MainLiveText,
		deltaTime: number
	): boolean => {
		// Update our springs
		const scale = this.UpdateSpring(liveText.Springs.Scale, deltaTime)
		const yOffset = this.UpdateSpring(liveText.Springs.YOffset, deltaTime)
		const opacity = this.UpdateSpring(liveText.Springs.Opacity, deltaTime)

		// Now update our objects
		EffectProperty(liveText.Object, "transform", `translateY(calc(var(--dot-size) * ${yOffset}))`, this.Options.counters)
		EffectProperty(liveText.Object, "scale", scale.toString(), this.Options.counters)
		EffectProperty(liveText.Object, "opacity", easeSinOut(opacity).toString(), this.Options.counters)

		// Determine if we are finally asleep or not
		return (
			liveText.Springs.Scale.IsSleeping()
			&& liveText.Springs.YOffset.IsSleeping()
			&& liveText.Springs.Opacity.IsSleeping()
		)
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

		for (const dot of this.Dots) {
			// Set our state and visuals
			this.UpdateLiveDotState(dot.LiveText, timeScale, timeScale, true)
			this.UpdateLiveDotVisuals(dot.LiveText, 0)
		}

		this.UpdateLiveMainState(this.LiveText, timeScale, true)
		this.UpdateLiveMainVisuals(this.LiveText, 0)

		this.State = (state ? "Sung" : "Idle")
		this.EvaluateClassState()
	}

	// Public Methods
	public Animate(songTimestamp: number, deltaTime: number, isImmediate?: true) {
		// Determine our relative time elements
		const relativeTime = (songTimestamp - this.StartTime)
		const timeScale = Clamp((relativeTime / this.Duration), 0, 1)

		// Determine if we should update our visual-states
		const pastStart = (relativeTime >= 0), beforeEnd = (relativeTime <= this.Duration)
		const isActive = (pastStart && beforeEnd)
		const stateNow = (
			isActive ? "Active"
				: pastStart ? "Sung"
					: "Idle"
		)
		const stateChanged = (stateNow != this.State)
		const shouldUpdateVisualState = (stateChanged || isActive || isImmediate)

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

			for (const dot of this.Dots) {
				// Determine our time-scale for the syllable
				const dotTimeScale = Clamp(
					((timeScale - dot.Start) / dot.Duration),
					0, 1
				)

				// Handle our main live-text
				{
					if (shouldUpdateVisualState) {
						this.UpdateLiveDotState(
							dot.LiveText,
							dotTimeScale, dotTimeScale,
							isImmediate
						)
					}

					if (isMoving) {
						const dotIsSleeping = this.UpdateLiveDotVisuals(
							dot.LiveText,
							deltaTime
						)

						if (dotIsSleeping === false) {
							isSleeping = false
						}
					}
				}
			}

			// Now handle updating our main live-text
			{
				if (shouldUpdateVisualState) {
					this.UpdateLiveMainState(this.LiveText, timeScale, isImmediate)
				}

				if (isMoving) {
					const mainIsSleeping = this.UpdateLiveMainVisuals(this.LiveText, deltaTime)

					if (mainIsSleeping === false) {
						isSleeping = false
					}
				}
			}

			if (isSleeping) {
				this.IsSleeping = true

				if (isActive === false) {
					this.EvaluateClassState()
				}
			}
		}
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

	public SetBlur() {} // Interlude we'll never use this since it will never be visible

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}