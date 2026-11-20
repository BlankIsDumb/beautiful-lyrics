// Styles
import "./style.scss"

// Packages
import { Giveable, Maid } from "@Universal/Modules/Maid.ts"

// Behavior Constants
const ScrollHappensEvery = 5
const ScrollPauseDuration = 2.5
const ScrollPixelSpeed = 15
const MinimumScrollDuration = 0.5 // Otherwise, it's too insignificant so we shouldn't bother

// Keep one shared wakeup. A zero timestamp means the animation needs frames;
// a future timestamp lets all waiting animations share a single timer.
const ActiveAnimations = new Map<HTMLDivElement, { NextUpdateAt: number; Update: (now: number) => number }>()
let animationFrame: number | undefined
let animationTimer: number | undefined
const ScheduleAnimations = (nextUpdateAt: number) => {
	if (nextUpdateAt === Infinity) return
	const delay = nextUpdateAt - performance.now()
	if (delay <= 0) {
		animationFrame = requestAnimationFrame(CallAnimations)
	} else {
		animationTimer = globalThis.setTimeout(() => {
			animationTimer = undefined
			animationFrame = requestAnimationFrame(CallAnimations)
		}, delay)
	}
}
const CallAnimations = () => {
	animationFrame = undefined
	const now = performance.now()
	let nextUpdateAt = Infinity
	for (const animation of ActiveAnimations.values()) {
		if (animation.NextUpdateAt <= now) animation.NextUpdateAt = animation.Update(now)
		nextUpdateAt = Math.min(nextUpdateAt, animation.NextUpdateAt)
	}
	ScheduleAnimations(nextUpdateAt)
}
const RearmAnimations = () => {
	if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
	if (animationTimer !== undefined) clearTimeout(animationTimer)
	animationFrame = animationTimer = undefined
	let nextUpdateAt = Infinity
	for (const animation of ActiveAnimations.values()) nextUpdateAt = Math.min(nextUpdateAt, animation.NextUpdateAt)
	ScheduleAnimations(nextUpdateAt)
}

// Class
export default class TextScroller implements Giveable {
	// Create our maid
	private Maid = new Maid()

	// Constructor
	constructor(
		textContainer: HTMLDivElement,
		observeSizeChangesOn: HTMLElement,
		isStaticSizing?: true
	) {
		// Set the base class based on the sizing-type
		const textElement = textContainer.querySelector<HTMLSpanElement>("span")!
		if (isStaticSizing) {
			textContainer.classList.add("TextScrollStaticSizing")
		}

		// Create our extra-shfit element IF needed
		let extraShiftElement: HTMLDivElement | undefined
		if (isStaticSizing === undefined) {
			extraShiftElement = this.Maid.Give(document.createElement("div"))
			extraShiftElement.classList.add("ExtraShift")
			textContainer.appendChild(extraShiftElement)
		}

		// Store our state here
		let containerPixelWidth = 0
		let textPixelWidth = 0
		let extraShift = 0

		// Determine if we should even animate
		const ShouldAnimate = () => {
			// Determine how long it would take for us to scroll the entirety of the text
			const excessWidth = (textPixelWidth - containerPixelWidth)
			const scrollDuration = (excessWidth / ScrollPixelSpeed)

			// Determine if we should animate
			if (scrollDuration >= MinimumScrollDuration) {
				textContainer.classList.add("TextScroll")

				let startTimestamp = (performance.now() + (ScrollHappensEvery * 1000))
				let endTimestamp = (startTimestamp + (scrollDuration * 1000))
				let returnTimestamp = (endTimestamp + (ScrollPauseDuration * 1000))
				let resetTimestamp = (returnTimestamp + (scrollDuration * 1000))

				ActiveAnimations.set(
					textContainer,
					{ NextUpdateAt: startTimestamp, Update: timeNow => {
						let progress: number
						if (timeNow <= endTimestamp) {
							progress = ((timeNow - startTimestamp) / (endTimestamp - startTimestamp))
						} else if (timeNow >= resetTimestamp) {
							textContainer.style.setProperty("--TextScrollShift", null)

							startTimestamp = (performance.now() + (ScrollHappensEvery * 1000))
							endTimestamp = (startTimestamp + (scrollDuration * 1000))
							returnTimestamp = (endTimestamp + (ScrollPauseDuration * 1000))
							resetTimestamp = (returnTimestamp + (scrollDuration * 1000))
							return startTimestamp
						} else if (timeNow > returnTimestamp) {
							progress = (1 - ((timeNow - returnTimestamp) / (resetTimestamp - returnTimestamp)))
						} else {
							return returnTimestamp
						}

						textContainer.style.setProperty(
							"--TextScrollShift",
							`${
								(excessWidth + extraShift)
								* (-(Math.cos(Math.PI * progress) - 1) / 2)
							}px`
						)
						return 0
					} }
				)
				RearmAnimations()

				if (this.Maid.Has("Animation") === false) {
					this.Maid.Give(() => {
						ActiveAnimations.delete(textContainer)
						RearmAnimations()
					}, "Animation")
				}
			} else {
				this.Maid.Clean("Animation")
				textContainer.style.setProperty("--TextScrollShift", null)
				textContainer.classList.remove("TextScroll")
			}
		}

		// Handle size changes
		const UpdatePixelSizes = () => {
			const computedContainerStyle = globalThis.getComputedStyle(textContainer)
			containerPixelWidth = (
				textContainer.offsetWidth
				- parseFloat(computedContainerStyle.paddingLeft)
				- parseFloat(computedContainerStyle.paddingRight)
			)
			textPixelWidth = textElement.offsetWidth

			if (isStaticSizing === undefined) {
				// This is done since margin-left for some reason affects flex sizing
				textContainer.style.setProperty("--TextWidth", `${textPixelWidth}px`)

				// Before ANYBODY asks, YES, this is mandatory, for some reason it's not the right value otherwise
				requestAnimationFrame(() => extraShift = extraShiftElement!.offsetWidth)
			}

			ShouldAnimate()
		}

		// Handle observers
		{
			const sizeObserver = this.Maid.Give(new ResizeObserver(UpdatePixelSizes))
			sizeObserver.observe(observeSizeChangesOn)

			const textObserver = this.Maid.Give(new MutationObserver(UpdatePixelSizes))
			textObserver.observe(textElement, { childList: true, characterData: true, subtree: true })
		}
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
