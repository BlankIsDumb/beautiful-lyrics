// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { Signal } from "@Universal/Modules/Signal.ts"
import { Defer } from "@Universal/Modules/Scheduler.ts"

// Components
import Button from "./Button.ts"

let activeSliderCount = 0

// Progress Calculation Helper
const CalculateProgressFromMouse = (bar: HTMLDivElement, mouseEvent: MouseEvent) => {
	const barBounds = bar.getBoundingClientRect()
	return Math.min(1, Math.max(0, (mouseEvent.clientX - barBounds.left) / barBounds.width))
}

// Class
export default class Slider implements Giveable {
	// Create our maid
	private Maid = new Maid()

	// Signal Definitions
	public readonly IsActiveChanged
	public readonly ProgressChanged

	// State Method Definitions
	public readonly GetHitBox
	public readonly IsActive
	public readonly GetProgress
	public readonly SetProgress

	// Constructor
	constructor(
		bar: HTMLDivElement,
		maximumValue: number = 1,
		userValueChangeStep?: number,
		minimumValue: number = 0,
		options: { pixelThreshold?: boolean; onResize?: () => void } = {}
	) {
		// Determine what we should use as our Hitbox
		const hitbox = (bar.querySelector<HTMLDivElement>(".Hitbox") ?? bar)
		this.GetHitBox = () => hitbox

		// Create our signals
		const [isActiveChanged, progressChanged] = this.Maid.GiveItems(
			new Signal<(isActive: boolean, mouseEvent: MouseEvent, currentProgress?: number) => void>(),
			new Signal<(progress: number, changedByUser?: true) => void>()
		)
		this.IsActiveChanged = isActiveChanged.GetEvent(), this.ProgressChanged = progressChanged.GetEvent()

		let progress = 0
		let lastVisualProgress: number | undefined
		let visualThreshold = 0
		const WriteVisualProgress = (force = false) => {
			const normalizedProgress = (progress - minimumValue) / (maximumValue - minimumValue)
			// Compare against the last painted position so subpixel ticks accumulate.
			if (!force && lastVisualProgress !== undefined && Math.abs(normalizedProgress - lastVisualProgress) < visualThreshold) return
			bar.style.setProperty("--SliderProgress", normalizedProgress.toString())
			lastVisualProgress = normalizedProgress
		}
		if (options.pixelThreshold) {
			const observer = this.Maid.Give(new ResizeObserver(([entry]) => {
				const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
				visualThreshold = width > 0 ? 0.5 / (width * globalThis.devicePixelRatio) : 0
				// The first SetProgress owns initialization, even if RO runs first.
				if (lastVisualProgress !== undefined) WriteVisualProgress(true)
				options.onResize?.()
			}))
			observer.observe(bar, { box: "border-box" })
		}

		// Keep the document cursor until every active slider has released it.
		let barActive = false
		const SetBarActive = (isActive: boolean) => {
			if (barActive === isActive) return
			barActive = isActive
			bar.classList.toggle("Active", isActive)
			activeSliderCount += isActive ? 1 : -1
			document.body.classList.toggle("JEL-SliderActive", activeSliderCount > 0)
		}
		this.Maid.Give(() => SetBarActive(false))

		// Store our active/mouse-event state and handle cancelling it
		let lastActiveMouseEvent: (MouseEvent | undefined)
		let active = false
		const CancelActiveState = (mouseEvent: MouseEvent = lastActiveMouseEvent!, dontSendProgress?: true) => {
			// Don't do anything IF we're already NOT active
			if (active === false) {
				return
			}

			// Immediately stop our MouseDrag
			this.Maid.Clean("MouseDrag")

			// Remove our class
			SetBarActive(false)
			if (options.pixelThreshold) WriteVisualProgress(true)

			// Set the inactive state
			active = false
			lastActiveMouseEvent = undefined
			isActiveChanged.Fire(false, mouseEvent, (dontSendProgress ? undefined : progress))
		}

		// Store our progress and state methods
		const SetProgress = (newProgress: number, changedByUser?: true, forceVisual?: boolean) => {
			progress = (
				((userValueChangeStep === undefined) || (changedByUser === undefined)) ? newProgress
				: (Math.floor(newProgress / userValueChangeStep) * userValueChangeStep)
			)
			WriteVisualProgress(forceVisual)
			progressChanged.Fire(progress, changedByUser)
		}
		this.IsActive = () => active
		this.GetProgress = () => progress
		this.SetProgress = (desiredProgress: number, newMaximumValue?: number, forceVisual = false) => {
			if (active) {
				CancelActiveState(undefined, true)
			}

			if (newMaximumValue !== undefined) {
				maximumValue = newMaximumValue
			}

			SetProgress(Math.max(minimumValue, Math.min(desiredProgress, maximumValue)), undefined, forceVisual || newMaximumValue !== undefined)
		}

		// Handle bar interactions (only need the bar since most of the handle is on it)
		{
			const UpdateProgressToMouse = (mouseEvent: MouseEvent) => {
				lastActiveMouseEvent = mouseEvent
				SetProgress(
					(minimumValue + (CalculateProgressFromMouse(bar, mouseEvent) * (maximumValue - minimumValue))),
					true
				)
			}
			const StartListeningForMouseDrag = () => {
				globalThis.addEventListener("mousemove", UpdateProgressToMouse)
				this.Maid.Give(() => globalThis.removeEventListener("mousemove", UpdateProgressToMouse), "MouseDrag")
			}

			const barButton = this.Maid.Give(new Button(hitbox, false, true))
			barButton.Pressed.Connect(
				(mouseEvent) => {
					// Set the active state
					active = true
					isActiveChanged.Fire(true, mouseEvent, progress)

					// Update our class-list
					if (this.Maid.IsDestroyed()) return
					SetBarActive(true)

					// Immediately set our progress
					UpdateProgressToMouse(mouseEvent)

					// Wait until the next process to start looking for mouse movements (prevents accidental micro-adjusting)
					this.Maid.Give(
						Defer(StartListeningForMouseDrag),
						"MouseDrag"
					)
				}
			)
			barButton.Released.Connect(CancelActiveState)
		}
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
