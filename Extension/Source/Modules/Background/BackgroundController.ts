import * as THREE from "jsr:@3d/three"
import { Maid, type Giveable } from "@Universal/Modules/Maid.ts"
import { IsPlaying, IsPlayingChanged } from "@Spices/Spicetify/Services/Player/mod.ts"
import { PresentationSettings, type PresentationView } from "../../PresentationSettings.ts"
import type { BackgroundProfile } from "../../BackgroundSettings.ts"
import { GetShaderUniforms, VertexShader, FragmentShader } from "../../LyricViews/Shaders.ts"
import { Acquire } from "./BackgroundArtwork.ts"
import { BackgroundClock, ShouldDraw, NextDrawTime } from "./BackgroundClock.ts"

const BackgroundClassName = "BeautifulLyricsBackground"
type Surface = "Contained" | "Fullscreen" | "Card"

export default class BackgroundController implements Giveable {
	private readonly Maid = new Maid()
	private readonly Active = new Maid()
	private readonly Clock = new BackgroundClock()
	private Profile: BackgroundProfile
	private Renderer: THREE.WebGLRenderer | undefined
	private Uniforms: ReturnType<typeof GetShaderUniforms> | undefined
	private Scene: THREE.Scene | undefined
	private Camera: THREE.OrthographicCamera | undefined
	private Frame: number | undefined
	private LastDraw: number | undefined
	private Dimensions: { width: number; height: number; ratio: number } | undefined
	private Dirty = false
	private Lost = false
	private Failed = false
	private Destroyed = false
	private OnScreen = true

	constructor(private readonly Element: HTMLElement, private readonly Options: { view: PresentationView; surface: Surface }) {
		this.Profile = PresentationSettings.getBackground(Options.view)
		this.Maid.Give(this.Active)
		this.Maid.Give(PresentationSettings.subscribeBackground((view, fields) => {
			if (view !== Options.view) return
			this.Profile = PresentationSettings.getBackground(view)
			if (this.Profile.mode === "off") { this.Deactivate(); return }
			if (!this.Renderer) { this.Activate(); return }
			this.SetBrightness()
			if (fields.includes("resolution")) this.Resize()
			// Brightness is CSS-only; every other transition restarts the timing
			// baseline without discarding virtual phase or rebuilding any lyrics.
			if (fields.some(field => field !== "brightness")) {
				this.Stop()
				this.RequestDraw()
			}
		}))
		if (this.Profile.mode !== "off") this.Activate()
	}

	private IsAnimating() {
		return this.OnScreen && this.Profile.mode === "animated" && (this.Profile.paused === "animate" || IsPlaying)
	}

	public SetOnScreen(onScreen: boolean) {
		if (this.Options.surface !== "Card" || this.Destroyed || this.OnScreen === onScreen) return
		this.OnScreen = onScreen
		if (!onScreen) this.Stop()
		// Retain the renderer and any dirty resize/artwork state while clipped.
		else if (this.Dirty || this.IsAnimating()) this.RequestDraw()
	}

	private Activate() {
		if (this.Destroyed || this.Failed || this.Renderer || this.Profile.mode === "off") return
		let renderer: THREE.WebGLRenderer
		try {
			renderer = new THREE.WebGLRenderer({ alpha: true })
		} catch (error) {
			// A broken/limited WebGL host must leave lyrics and settings usable.
			this.Failed = true
			console.warn("Just Enough Lyrics background unavailable", error)
			return
		}
		this.Renderer = renderer
		const canvas = renderer.domElement
		canvas.classList.add(`${BackgroundClassName}-Container`)
		const uniforms = this.Uniforms = GetShaderUniforms()
		const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VertexShader, fragmentShader: FragmentShader })
		const geometry = new THREE.PlaneGeometry(2, 2)
		this.Scene = new THREE.Scene()
		this.Scene.add(new THREE.Mesh(geometry, material))
		this.Camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
		this.Camera.position.z = 1
		this.Active.Give(() => {
			uniforms.BlurredCoverArt.value?.dispose()
			material.dispose()
			geometry.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
			canvas.remove()
		})
		if (this.Options.surface === "Card") {
			const hadClassAttribute = this.Element.hasAttribute("class")
			this.Element.classList.add(BackgroundClassName)
			this.Active.Give(() => {
				this.Element.classList.remove(BackgroundClassName)
				// Removing the last token otherwise leaves a new class="" on Off.
				if (!hadClassAttribute && this.Element.getAttribute("class") === "") this.Element.removeAttribute("class")
			})
		}
		this.Element.prepend(canvas)
		this.SetBrightness()

		const artwork = Acquire()
		this.Active.Give(() => artwork.Release())
		const UpdateTexture = () => {
			const image = artwork.Current()
			if (!image || this.Lost) return
			uniforms.BlurredCoverArt.value?.dispose()
			const texture = new THREE.CanvasTexture(image)
			texture.minFilter = THREE.NearestFilter
			texture.magFilter = THREE.NearestFilter
			uniforms.BlurredCoverArt.value = texture
			this.RequestDraw()
		}
		this.Active.Give(artwork.Changed.Connect(UpdateTexture))
		const OnLost = (event: Event) => {
			event.preventDefault()
			this.Lost = true
			this.Stop()
		}
		const OnRestored = () => {
			this.Lost = false
			this.Dimensions = undefined
			this.Resize()
			UpdateTexture()
			this.RequestDraw()
		}
		canvas.addEventListener("webglcontextlost", OnLost)
		canvas.addEventListener("webglcontextrestored", OnRestored)
		this.Active.Give(() => {
			canvas.removeEventListener("webglcontextlost", OnLost)
			canvas.removeEventListener("webglcontextrestored", OnRestored)
		})
		this.Active.Give(IsPlayingChanged.Connect(() => {
			if (this.IsAnimating()) this.RequestDraw()
			else {
				this.Stop()
				// A pause can race an artwork/resize invalidation before its frame.
				// Keep that single draw; only the continuous animation must stop.
				if (this.Dirty) this.RequestDraw()
			}
		}))
		const observer = this.Active.Give(new ResizeObserver(() => this.Resize()))
		observer.observe(this.Element)

		// The query must be rearmed at each new DPR. No polling/layout reads
		// occur on the common frame path, including on high-refresh displays.
		let query: MediaQueryList
		const OnDpr = () => {
			query?.removeEventListener("change", OnDpr)
			query = matchMedia(`(resolution: ${globalThis.devicePixelRatio}dppx)`)
			query.addEventListener("change", OnDpr)
			this.Resize()
		}
		OnDpr()
		this.Active.Give(() => query.removeEventListener("change", OnDpr))
		UpdateTexture()
		this.RequestDraw()
	}

	private SetBrightness() {
		this.Renderer?.domElement.style.setProperty("--jel-background-brightness", String(this.Profile.brightness / 100))
	}

	private Resize() {
		if (!this.Renderer || !this.Uniforms || this.Lost) return
		const scale = this.Profile.resolution === "full" ? 1 : this.Profile.resolution === "half" ? 0.5 : 0.25
		const ratio = globalThis.devicePixelRatio * scale
		const width = this.Element.clientWidth, height = this.Element.clientHeight
		if (this.Dimensions?.width === width && this.Dimensions.height === height && this.Dimensions.ratio === ratio) return
		if (this.Dimensions?.ratio !== ratio) this.Renderer.setPixelRatio(ratio)
		this.Renderer.setSize(width, height)
		this.Dimensions = { width, height, ratio }
		// Match actual drawing-buffer pixels (Three floors fractional DPR sizes).
		const scaledWidth = Math.floor(width * ratio), scaledHeight = Math.floor(height * ratio)
		const wide = scaledWidth > scaledHeight
		const largest = Math.max(scaledWidth, scaledHeight)
		const uniforms = this.Uniforms
		uniforms.BackgroundCircleOrigin.value.set(scaledWidth / 2, scaledHeight / 2)
		uniforms.BackgroundCircleRadius.value = largest * 1.5
		uniforms.CenterCircleOrigin.value.set(scaledWidth / 2, scaledHeight / 2)
		uniforms.CenterCircleRadius.value = largest * (wide ? 1 : 0.75)
		uniforms.LeftCircleOrigin.value.set(0, scaledHeight)
		uniforms.LeftCircleRadius.value = largest * 0.75
		uniforms.RightCircleOrigin.value.set(scaledWidth, 0)
		uniforms.RightCircleRadius.value = largest * (wide ? 0.65 : 0.5)
		this.RequestDraw()
	}

	private RequestDraw() {
		if (!this.Renderer || this.Lost || this.Destroyed) return
		this.Dirty = true
		if (this.OnScreen && this.Frame === undefined) this.Frame = requestAnimationFrame(now => this.Draw(now))
	}

	private Draw(now: number) {
		this.Frame = undefined
		if (!this.OnScreen || !this.Renderer || !this.Uniforms || this.Lost || this.Destroyed) return
		const animated = this.IsAnimating()
		const capDue = animated && ShouldDraw(now, this.LastDraw, this.Profile.fps)
		if (this.Dirty || capDue) {
			this.Dirty = false
			this.Uniforms.Time.value = animated ? this.Clock.Step(now, this.Profile.motion) : this.Clock.Current()
			this.Renderer.render(this.Scene!, this.Camera!)
			// Forced draws must not consume future cap intervals. Repeated resize
			// frames would otherwise push the deadline ahead and stall animation.
			if (capDue) this.LastDraw = NextDrawTime(now, this.LastDraw, this.Profile.fps)
			else if (this.LastDraw === undefined) this.LastDraw = now
		}
		if (animated) this.Frame = requestAnimationFrame(time => this.Draw(time))
	}

	private Stop() {
		if (this.Frame !== undefined) cancelAnimationFrame(this.Frame)
		this.Frame = undefined
		this.LastDraw = undefined
		this.Clock.Freeze()
	}

	private Deactivate() {
		this.Stop()
		this.Active.CleanUp()
		this.Renderer = undefined
		this.Uniforms = undefined
		this.Scene = undefined
		this.Camera = undefined
		this.Dimensions = undefined
		this.Lost = false
		this.Dirty = false
	}

	public Destroy() {
		if (this.Destroyed) return
		this.Destroyed = true
		this.Deactivate()
		this.Maid.Destroy()
	}
}
