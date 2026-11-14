import type { BackgroundProfile } from "../../BackgroundSettings.ts"

export class BackgroundClock {
	private Previous: number | undefined
	private Time = 0

	public Step(now: number, motion: BackgroundProfile["motion"]) {
		if (this.Previous !== undefined) {
			const delta = Math.max(0, Math.min(250, now - this.Previous))
			this.Time += delta * (motion === "slow" ? 0.5 : motion === "fast" ? 2 : 1) / 3500
		}
		this.Previous = now
		return this.Time
	}

	// Forget wall time, keeping phase. A paused/hidden interval cannot jump ahead.
	public Freeze() { this.Previous = undefined }
	public Current() { return this.Time }
}

export const ShouldDraw = (now: number, lastDraw: number | undefined, fps: BackgroundProfile["fps"]) =>
	lastDraw === undefined || fps === "uncapped" || now - lastDraw >= 1000 / Number(fps) - 1

// Retain the interval remainder instead of resetting to each rAF's timestamp.
// The tolerance permits a frame slightly early, never accumulating that error.
export const NextDrawTime = (now: number, lastDraw: number | undefined, fps: BackgroundProfile["fps"]) => {
	if (lastDraw === undefined || fps === "uncapped") return now
	const interval = 1000 / Number(fps)
	return lastDraw + Math.max(1, Math.floor((now - lastDraw + 1) / interval)) * interval
}
