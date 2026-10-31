// Packages
import type { AnnotationLayoutJob } from "./AnnotationLayout.ts"
import type { TextSprings } from "./RenderEffects.ts"
import { Event } from "@Universal/Modules/Signal.ts"

// General Types
type TimeValue = {
	Time: number;
	Value: number;
}
type TimeValueRange = TimeValue[]
type Springs = TextSprings
type LiveText = {
	Object: HTMLSpanElement;
	Springs?: Springs;
}
type LyricState = ("Idle" | "Active" | "Sung")

// Shared Class Definitions
type BaseVocals = object
interface SyncedVocals extends BaseVocals {
	// Public Properties
	ActivityChanged: Event<(isActive: boolean) => void>
	RequestedTimeSkip: Event<() => void>

	// Public Methods
	Animate(songTimestamp: number, deltaTime: number, isImmediate?: true): void
	SetBlur(blurDistance: number): void
	NeedsFrame(): boolean
	IsActive(): boolean
	HasAnnotations?(): boolean
	PrepareAnnotations?(fontGeneration?: number): AnnotationLayoutJob | undefined
	MeasureAnnotations?(fontGeneration?: number): void
	GetScrollTarget?(): { Element: HTMLElement; StartTime: number }
}

// Exports
export { TimeValue, TimeValueRange, Springs, LiveText, LyricState, BaseVocals, SyncedVocals }
