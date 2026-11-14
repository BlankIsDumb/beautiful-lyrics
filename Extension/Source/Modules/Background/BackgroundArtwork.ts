import { Signal } from "@Universal/Modules/Signal.ts"
import { SongChanged, SongContextChanged } from "@Spices/Spicetify/Services/Player/mod.ts"
import { GetCoverArtForSong } from "../../LyricViews/Shared.ts"

const Changed = new Signal()
let Consumers = 0
let Canvas: OffscreenCanvas | undefined
let Key: string | undefined
let Generation = 0
let Connections: { Disconnect(): void }[] = []
// One weak cache permits page-to-fullscreen handoff without retaining a large
// canvas after the last consumer leaves. GC may reclaim it at any time.
let Cached: { key: string; canvas: WeakRef<OffscreenCanvas> } | undefined

const Generate = async () => {
	const [coverArt, placeholderHueShift] = GetCoverArtForSong()
	const key = JSON.stringify([coverArt, placeholderHueShift])
	if (key === Key) return
	Key = key
	const generation = ++Generation
	const cached = Cached?.key === key ? Cached.canvas.deref() : undefined
	if (cached) {
		Canvas = cached
		Changed.Fire()
		return
	}
	try {
		const image = new Image()
		image.src = coverArt
		await image.decode()
		// Stale decoding must not proceed to blur after its owner/song disappears.
		if (!Consumers || generation !== Generation || GetCoverArtForSong()[0] !== coverArt) return

		const originalSize = Math.min(image.width, image.height) // Crop to a square
		const blurExtent = Math.ceil(3 * 40) // Blur spread extent

		// Create a square canvas to crop the image into a circle
		const circleCanvas = new OffscreenCanvas(originalSize, originalSize)
		const circleCtx = circleCanvas.getContext('2d')!

		// Create circular clipping mask
		circleCtx.beginPath()
		circleCtx.arc(originalSize / 2, originalSize / 2, originalSize / 2, 0, Math.PI * 2)
		circleCtx.closePath()
		circleCtx.clip()

		// Draw the original image inside the circular clip
		circleCtx.drawImage(
			image,
			((image.width - originalSize) / 2), ((image.height - originalSize) / 2),
			originalSize, originalSize,
			0, 0,
			originalSize, originalSize
		)

		// Expand canvas to accommodate blur effect
		const padding = (blurExtent * 1.5)
		const expandedSize = originalSize + padding
		const blurredCanvas = new OffscreenCanvas(expandedSize, expandedSize)
		const blurredCtx = blurredCanvas.getContext('2d')!

		blurredCtx.filter = `hue-rotate(${placeholderHueShift ?? 0}deg) blur(${40}px)`

		// Draw the cropped circular image in the center of the expanded canvas
		blurredCtx.drawImage(circleCanvas, (padding / 2), (padding / 2))

		if (Consumers && generation === Generation && GetCoverArtForSong()[0] === coverArt) {
			Canvas = blurredCanvas
			Cached = { key, canvas: new WeakRef(blurredCanvas) }
			Changed.Fire()
		}
	} catch {
		// An unavailable image must never prevent the lyrics view from mounting.
		if (generation === Generation) Key = undefined
	}
}
const Refresh = () => { void Generate() }

export function Acquire() {
	if (++Consumers === 1) {
		Connections = [SongChanged.Connect(Refresh), SongContextChanged.Connect(Refresh)]
		Refresh()
	}
	let released = false
	return {
		Current: () => released ? undefined : Canvas,
		Changed: Changed.GetEvent(),
		Release() {
			if (released) return
			released = true
			if (--Consumers !== 0) return
			for (const connection of Connections) connection.Disconnect()
			Connections = []
			Canvas = undefined
			Key = undefined
			++Generation // Also invalidate pending decoding of the same URL on reacquire.
		},
	}
}
