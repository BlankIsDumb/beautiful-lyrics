import { RunAnnotationLayout } from "./AnnotationLayout.ts"
import { ClassicLayout, type LayoutProfile } from "../../LayoutSettings.ts"
import type { RenderingCounters } from "../../RenderingSettings.ts"
// NPM
import "../../Simplebar/style.css"
// @deno-types="npm:@types/simplebar"
import SimpleBar from "npm:simplebar"

// Packages
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { Timeout, Defer, OnPreRender } from "@Universal/Modules/Scheduler.ts"

// Imported Types
import { BaseVocals, SyncedVocals } from "./Types.d.ts"
import { overlapScrollTarget } from "./OverlapScroll.mjs"

// Types
type VocalGroup<V extends (BaseVocals | SyncedVocals)> = {
	GroupContainer: (HTMLDivElement | HTMLButtonElement),
	Vocals: V[] 
}
export type VocalGroups<V extends (BaseVocals | SyncedVocals)> = VocalGroup<V>[]

// Visual Constants
const DistanceToMaximumBlur = 4 // Any vocals beyond this unit of distance away will be at full-blur
const BlurScale = 1.25 // How much we scale the blur by

// Helper Method
const GetTotalElementHeight = (element: HTMLElement): number => {
    if (element.hidden) return 0 // Hidden cue slots must not retain computed margins.
	const style = globalThis.getComputedStyle(element)
	const marginTop = parseFloat(style.marginTop)
	const marginBottom = parseFloat(style.marginBottom)

	return (element.offsetHeight + marginTop + marginBottom)
}

// Class
export class LyricsScroller<V extends (BaseVocals | SyncedVocals)> implements Giveable {
	// Private Properties
	private readonly Maid: Maid

	private readonly ScrollContainer: HTMLDivElement
	private readonly LyricsContainer: HTMLDivElement
	private readonly VocalGroups: VocalGroups<V>

	private readonly LyricsAreSynced: boolean

	private readonly Scroller: SimpleBar
	private readonly ScrollerObject: HTMLElement
	private GroupDimensions: {
		Height: number;
		Center: number;
		Top: number;
		Bottom: number;
	}[] = []
    private VoiceBounds = new Map<SyncedVocals,{top:number;bottom:number;start:number}>()
	private AutoScrollBlocked: boolean = false
	private AutoScrolling: boolean = false
	private LastActiveVocalIndex: number = 0
	private LyricsEnded: boolean = false
	private MoveQueued = false
    private MoveGeneration = 0
	private LayoutQueued = false
    private PreserveManualGrace = false
    private AnnotationBlurQueued = false
    private Profile: LayoutProfile
    private PendingResume = false
    private ManualDeadline = 0
    private LastManualAt = 0
    private ExplicitClick = false
    private ForceInstant = false
    private GeometryValid = false

	// Constructor
	public constructor(
		scrollContainer: HTMLDivElement, lyricsContainer: HTMLDivElement,
		vocalGroups: VocalGroups<V>, lyricsAreSynced: boolean, private BlurEnabled = true, private counters?: RenderingCounters,
        private options: { profile?: LayoutProfile; browsing?: (browsing: boolean) => void; measured?: () => void } = {}
	) {
		this.Profile = { ...ClassicLayout, anchor: null, ...options.profile }
		// Mark our synced-state
		this.LyricsAreSynced = lyricsAreSynced

		// Create our maid
		this.Maid = new Maid()

		// Create our scroller
		this.Scroller = new SimpleBar(scrollContainer)
		this.ScrollerObject	= this.Scroller.getScrollElement()!
		this.Maid.Give(this.Scroller.unMount.bind(this.Scroller))

		// Store our arguments
		this.ScrollContainer = scrollContainer, this.LyricsContainer = lyricsContainer
		this.VocalGroups = vocalGroups

		// On scroll, block auto-scrolling
		this.WatchAutoScrollBlocking()

		// Watch for size changes
		const resizeObserver = this.Maid.Give(
			new ResizeObserver(
				() => {
                    this.QueueLayoutMeasure()
				}
			)
		)
		resizeObserver.observe(this.ScrollContainer)
		// Font size/wrapping and background-vocal layout can change while the
		// viewport stays fixed. A single observer owns these bounded lyric nodes;
		// transforms on animated spans do not trigger ResizeObserver.
		for (const group of vocalGroups) resizeObserver.observe(group.GroupContainer)

        // Source-only custom fonts need the same invalidation as reading fonts.
        // One renderer listener owns both demands, with no loading poller.
        document.fonts?.addEventListener("loadingdone", this.AnnotationFontReady)
        this.Maid.Give(() => document.fonts?.removeEventListener("loadingdone", this.AnnotationFontReady));

        // Immediately update our heights
		this.UpdateLyricHeights()

		// Synced lyrics have more complex interactions so we don't need to apply these to Static lyrics
		if (lyricsAreSynced) {
			// Handle our lyric active state changes since this affects scrolling/sizing
			this.HandleLyricActiveStateChanges()

			// Handle moving ourselves to the active lyrics
			this.MoveToActiveLyrics(true)
		}
	}

    // Eligibility can hide a zero-content cue group without changing its content
    // box, so ResizeObserver alone cannot detect the removed CSS margins.
    public RefreshCueLayout() {
        this.DetermineLyricBlur()
        this.PreserveManualGrace = true
        this.QueueLayoutMeasure()
    }
    // Async rows and typography changes share the same native resize batch and
    // existing 750ms user grace. No new timer or observer is needed.
    private AnnotationFontGeneration = 0
    private AnnotationFontReady = () => { this.AnnotationFontGeneration++; this.RefreshAnnotationLayout() }
    public RefreshAnnotationLayout() {
        // Shared source/reading font listener above invalidates fits even when
        // the named font stack and total group height happen to be unchanged.
        this.PreserveManualGrace = true
        this.AnnotationBlurQueued = true
        this.QueueLayoutMeasure()
    }
    private QueueLayoutMeasure() {
        if (this.LayoutQueued) return
        this.LayoutQueued = true
        this.Maid.Give(OnPreRender(() => {
            this.LayoutQueued = false
            const preserve = this.PreserveManualGrace
            if (!this.AutoScrollBlocked) this.PreserveManualGrace = false
            this.UpdateLyricHeights()
            if (this.AnnotationBlurQueued) { this.AnnotationBlurQueued = false; this.DetermineLyricBlur() }
            if (this.LyricsAreSynced && !(preserve && this.AutoScrollBlocked)) this.MoveToActiveLyrics()
        }), "MeasureLyrics")
    }
    public RefreshLayout() { this.CancelProgrammaticScroll(); this.PreserveManualGrace = true; this.QueueLayoutMeasure() }
    public IsBrowsing() { return this.AutoScrollBlocked }
    public SetProfile(profile: LayoutProfile) {
        const old = this.Profile
        this.Profile = { ...profile }
        if (!profile.follow) {
            // An unrelated context edit while already Off must not cancel an
            // explicit lyric-click transition or write another scroll position.
            if(old.follow) this.CancelProgrammaticScroll()
            this.Maid.Clean("WaitForUserToStopScrolling")
            this.PendingResume = false
        }
        else if(!old.follow) {
            // Explicitly enabling follow is an intentional resume action, not
            // another playback event subject to an old browsing grace period.
            this.Maid.Clean("WaitForUserToStopScrolling")
            this.PendingResume=false;this.ToggleAutoScrollBlock(false)
        }
        else if(this.AutoScrollBlocked && (old.resume!==profile.resume || old.resumeDelay!==profile.resumeDelay)) this.ArmManualResume()
        this.options.browsing?.(this.AutoScrollBlocked)
        if (profile.follow && (!old.follow || old.anchor !== profile.anchor)) this.MoveToActiveLyrics()
    }

	// Private Methods
	private ToggleAutoScrollBlock(blocked: boolean) {
		if (this.AutoScrollBlocked !== blocked) {
			if (blocked) {
				this.AutoScrollBlocked = true
				this.ScrollContainer.classList.add("UserScrolling")
			} else {
				this.AutoScrollBlocked = false
                this.PreserveManualGrace = false
				this.ScrollContainer.classList.remove("UserScrolling")
			}
            this.options.browsing?.(blocked)
		}
	}

    private FinishManualScrollGrace() {
        // A cue edit protects the current grace window only. If its timeout
        // lands in silence, MoveToActiveLyrics returns before unblocking; do not
        // leave the cue guard latched and suppress future playback activity.
        this.PreserveManualGrace = false
        if (!this.Profile.follow) return
        if (this.Profile.resume === "delay") {
            // Silence does not cause a retry loop. The next real activity will
            // complete resume; until then the user keeps All and their position.
            if (!(this.VocalGroups as VocalGroups<SyncedVocals>).some(group => group.Vocals.some(vocal => vocal.IsActive()))) { this.PendingResume = true; return }
            this.ToggleAutoScrollBlock(false)
        }
        this.MoveToActiveLyrics()
    }
    private ArmManualResume() {
        this.Maid.Clean("WaitForUserToStopScrolling")
        this.PendingResume=false
        this.ManualDeadline=this.LastManualAt+this.Profile.resumeDelay*1000
        if(!this.Profile.follow)return
        const remaining=Math.max(0,(this.ManualDeadline-performance.now())/1000)
        this.Maid.Give(Timeout(remaining,()=>this.FinishManualScrollGrace()),"WaitForUserToStopScrolling")
    }

	private WatchAutoScrollBlocking() {
        const manual = () => {
            this.CancelProgrammaticScroll()
            this.ToggleAutoScrollBlock(true)
            this.PendingResume = false
            this.LastManualAt=performance.now()
            this.ArmManualResume()
        }
        const callback = () => {
            if (this.AutoScrolling) this.ArmProgrammaticEnd()
            else manual()
        }
        const key = (event: KeyboardEvent) => {
            if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return
            if (["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"," "].includes(event.key)) manual()
        }
        const pointer = (event: PointerEvent) => {
            if ((event.target as HTMLElement)?.closest(".simplebar-track")) manual()
        }
        const end = () => { this.AutoScrolling = false; this.Maid.Clean("WaitForAutoScroll") }
        this.ScrollContainer.addEventListener("wheel", manual, {passive:true})
        this.ScrollContainer.addEventListener("touchmove", manual, {passive:true})
        this.ScrollContainer.addEventListener("pointerdown", pointer)
        this.ScrollerObject.addEventListener("keydown", key)
        this.ScrollerObject.addEventListener("scrollend", end)
        this.Maid.Give(() => {
            this.ScrollContainer.removeEventListener("wheel", manual); this.ScrollContainer.removeEventListener("touchmove", manual)
            this.ScrollContainer.removeEventListener("pointerdown", pointer); this.ScrollerObject.removeEventListener("keydown", key)
            this.ScrollerObject.removeEventListener("scrollend", end)
        })

		this.ScrollerObject.addEventListener("scroll", callback)
		this.Maid.Give(() => this.ScrollerObject.removeEventListener("scroll", callback))
	}
    private ArmProgrammaticEnd() {
        // Native smooth can outlive Classic's old 1/30s tail. scrollend is the
        // primary completion signal; a single bounded inactivity timeout also
        // supports older CEF versions. No position polling or animation loop.
        this.Maid.Give(Timeout(.2, () => { this.AutoScrolling = false }), "WaitForAutoScroll")
    }
    private CancelProgrammaticScroll() {
        if (this.AutoScrolling) this.ScrollerObject.scrollTo({ top: this.ScrollerObject.scrollTop, behavior: "instant" as ScrollBehavior })
        this.AutoScrolling = false
        this.Maid.Clean("WaitForAutoScroll")
    }

	private HandleLyricActiveStateChanges() {
		for(const vocalGroup of this.VocalGroups as VocalGroups<SyncedVocals>) {
			for(const vocal of vocalGroup.Vocals) {
				this.Maid.Give(
					vocal.ActivityChanged.Connect(() => this.QueueActiveMove())
				)
			}
		}
	}

	private QueueActiveMove() {
		if (this.MoveQueued) return
		this.MoveQueued = true
        const generation=++this.MoveGeneration
		// ActivityChanged fires during the animator's loop. Wait until every
		// vocal has its new state before choosing the overlap viewport.
		queueMicrotask(() => {
            if(generation!==this.MoveGeneration)return
			this.MoveQueued = false
			if (!this.Maid.IsDestroyed() && !(this.PreserveManualGrace && this.AutoScrollBlocked)) this.MoveToActiveLyrics(true)
		})
	}

	private UpdateLyricHeights() {
		if (!this.LyricsContainer.isConnected || this.ScrollContainer.clientWidth <= 0 || this.ScrollContainer.clientHeight <= 0) { this.GeometryValid = false; return }
        const oldScroll=this.ScrollerObject.scrollTop
        const readingIndex=this.AutoScrollBlocked ? this.GroupDimensions.findIndex(group=>group.Bottom>oldScroll) : -1
        const readingOffset=readingIndex>=0 ? oldScroll-this.GroupDimensions[readingIndex].Top : 0
		// Clear our heights
		this.GroupDimensions = []

        // Prepare keys before any writes; then every annotated voice crosses
        // each measurement barrier together, before any group-height reads.
        const wrapWrites=[]
        for(const group of this.VocalGroups)for(const vocal of group.Vocals) {
            const write=(vocal as SyncedVocals).PrepareSourceWrapping?.();if(write)wrapWrites.push(write)
        }
        for(const write of wrapWrites)write()
        const jobs = []
        for (const group of this.VocalGroups) for (const vocal of group.Vocals) {
            const synced = vocal as SyncedVocals
            if (synced.PrepareAnnotations) {
                const job = synced.PrepareAnnotations(this.AnnotationFontGeneration)
                if (job) jobs.push(job)
            } else synced.MeasureAnnotations?.(this.AnnotationFontGeneration)
        }
        RunAnnotationLayout(jobs)
		// Now update our heights
		let totalHeight = 0
		for (const vocalGroup of this.VocalGroups) {
            const groupHeight = GetTotalElementHeight(vocalGroup.GroupContainer)

			this.GroupDimensions.push(
				{
					Height: (groupHeight / 2),
					Center: (totalHeight + (groupHeight / 2)), Top:0, Bottom:0
				}
			)
			totalHeight += groupHeight
		}

		// Update our container height
        const height=`${totalHeight}px`
        if(this.LyricsContainer.style.height!==height)this.LyricsContainer.style.height=height
		this.Scroller.recalculate()
        const frame=this.ScrollerObject.getBoundingClientRect()
        const scale=frame.height/this.ScrollerObject.clientHeight || 1
        const scrollTop=this.ScrollerObject.scrollTop
        const lyricsTop=(this.LyricsContainer.getBoundingClientRect().top-frame.top)/scale+scrollTop
        this.VoiceBounds.clear()
        for(const [index,group] of (this.VocalGroups as VocalGroups<SyncedVocals>).entries()) {
            const rect=group.GroupContainer.getBoundingClientRect()
            const top=(rect.top-frame.top)/scale+scrollTop,bottom=(rect.bottom-frame.top)/scale+scrollTop
            this.GroupDimensions[index].Top=top;this.GroupDimensions[index].Bottom=bottom
            // Classic centers remain in Lyrics-local coordinates; follow bounds
            // use ONE content-scroll CSS-pixel frame, including fractional boxes.
            this.GroupDimensions[index].Center=(top+bottom)/2-lyricsTop
            for(const vocal of group.Vocals) {
                const target=vocal.GetScrollTarget?.(),bounds=(target?.Element??group.GroupContainer).getBoundingClientRect()
                this.VoiceBounds.set(vocal,{top:(bounds.top-frame.top)/scale+scrollTop,bottom:(bounds.bottom-frame.top)/scale+scrollTop,start:target?.StartTime??0})
            }
        }
        if(readingIndex>=0) {
            const next=this.GroupDimensions[readingIndex].Top+readingOffset
            if(Math.abs(next-this.ScrollerObject.scrollTop)>.1) {
                this.AutoScrolling=true
                this.ScrollerObject.scrollTo({top:next,behavior:"instant" as ScrollBehavior})
                this.ArmProgrammaticEnd()
            }
        }
        this.GeometryValid = true
        this.options.measured?.()
	}

	public SetBlurEnabled(enabled: boolean) {
        if (this.BlurEnabled === enabled) return
        this.BlurEnabled = enabled
        if (enabled) this.DetermineLyricBlur()
        else for (const group of this.VocalGroups as VocalGroups<SyncedVocals>) for (const vocal of group.Vocals) {
            (vocal as SyncedVocals & { ClearBlur?(): void }).ClearBlur?.()
        }
    }

    private DetermineLyricBlur() {
        // Blur Off skips both the activity scan and distance/style work.
        if (!this.BlurEnabled || !this.LyricsAreSynced) return
        if (this.counters) this.counters.blurCalculations++
		// Grab our start/end incides for our active vocals (we go by vocal not by group in this instance)
		let startIndex: (number | undefined), endIndex: (number | undefined)
		const vocals = []
		for (const vocalGroup of (this.VocalGroups as VocalGroups<SyncedVocals>)) {
            if (vocalGroup.GroupContainer.hidden) continue
			for(const vocal of vocalGroup.Vocals) {
				if (vocal.IsActive()) {
					const vocalIndex = vocals.length

					if (startIndex === undefined) {
						startIndex = vocalIndex
					}

					endIndex = vocalIndex
				}

				vocals.push(vocal)
			}
		}

		// If we don't have a start-index then set it to the end vocal
		if ((startIndex === undefined) || (endIndex === undefined)) {
			startIndex = Math.min(this.LastActiveVocalIndex, Math.max(0, vocals.length - 1))
			endIndex = startIndex
		} else {
			this.LastActiveVocalIndex = startIndex
		}

		// Now go through our vocals and apply the blur
		for (const [index, vocal] of vocals.entries()) {
			// Grab our distance
			const distance = Math.min(
				(
					(index < startIndex) ? (startIndex - index)
					: (index > endIndex) ? (index - endIndex)
					: 0
				),
				DistanceToMaximumBlur
			)

			// Update our blur now
			vocal.SetBlur(distance * BlurScale)
		}
	}

	private MoveToActiveLyrics(redetermineBlur?: true) {
		// We can't move to any active-lyrics if we aren't synced
		if (this.LyricsAreSynced === false) {
			return
		}

		// We need to redetermine our blur
		if (redetermineBlur) {
			this.DetermineLyricBlur()
		}
        if ((!this.Profile.follow && !this.ExplicitClick) || !this.GeometryValid) return
        if (this.AutoScrollBlocked && this.Profile.resume === "delay") {
            if (performance.now() < this.ManualDeadline) return
        }

		// If we're still scrolling then don't do anything
		if (this.AutoScrollBlocked && this.Scroller.isScrolling) {
			return
		}

		// Grab the margin that the lyrics-container adds at the top (this affects our scroll-position)
		const lyricsContainerStyle = globalThis.getComputedStyle(this.LyricsContainer)
		const lyricsContainerMarginTop = parseInt(lyricsContainerStyle.marginTop!)
		
		// Check if we have an offset defined
		const offset = (
			(lyricsContainerStyle.getPropertyValue("--use-offset") === "1")
			? parseInt(lyricsContainerStyle.lineHeight!)
			: 0
		)

		// Determine our minimum distance away from the top
		const scrollViewportHeight = this.ScrollContainer.offsetHeight
		const viewportCenter = ((scrollViewportHeight / 2) - offset)
		const minimumDistanceToAutoScroll = (viewportCenter - lyricsContainerMarginTop)
		const currentScrollTop = this.ScrollerObject.scrollTop
		const maximumScrollTop = (this.ScrollerObject.scrollHeight - scrollViewportHeight)

		// Grab our active vocal-groups
		const activeVocalGroups = []
		for (const [index, vocalGroup] of (this.VocalGroups as VocalGroups<SyncedVocals>).entries()) {
			if (vocalGroup.Vocals.some(vocal => vocal.IsActive())) {
				activeVocalGroups.push(
					{
						Dimensions: this.GroupDimensions[index],
						Group: vocalGroup
					}
				)
			}
		}

		// If we have no active vocal-groups don't even bother
		if (activeVocalGroups.length === 0) {
			if ((this.AutoScrollBlocked === false) && this.LyricsEnded) {
				if (currentScrollTop < maximumScrollTop) {
					this.ScrollTo(maximumScrollTop)
				}
			}

			return
		}
        if(this.AutoScrollBlocked && this.Profile.resume==="delay" && performance.now()>=this.ManualDeadline) {
            this.PendingResume=false;this.ToggleAutoScrollBlock(false)
        }

		// Now determine our center
		const activeVocals = activeVocalGroups.flatMap(g => g.Group.Vocals.filter(v => v.IsActive()))
        if (this.Profile.anchor !== null && !this.AutoScrollBlocked) {
            const height = this.ScrollerObject.clientHeight
            // The existing card/page fades are unreadable above24/below64px.
            const safeTop = Math.min(24, height / 2), safeBottom = Math.min(64, Math.max(0, height - safeTop - 1))
            const usable = Math.max(1, height - safeTop - safeBottom)
            const bounds = activeVocalGroups.flatMap(g => g.Group.Vocals.filter(v => v.IsActive()).map(v => {
                const bounds=this.VoiceBounds.get(v)!
                return {...bounds,top:bounds.top-safeTop,bottom:bounds.bottom-safeTop}
            }))
            const unionTop=Math.min(...bounds.map(b=>b.top)),unionBottom=Math.max(...bounds.map(b=>b.bottom))
            let target=overlapScrollTarget(bounds,usable,currentScrollTop,maximumScrollTop)
            // If the complete active block already fits, preserve the viewport.
            if (!(unionTop>=currentScrollTop && unionBottom<=currentScrollTop+usable)) {
                const newest=[...bounds].sort((a,b)=>b.start-a.start||b.top-a.top)[0]
                const block=unionBottom-unionTop<=usable?{top:unionTop,bottom:unionBottom}:newest
                if(block.bottom-block.top>usable) target=block.top
                else target=Math.max(block.bottom-usable, Math.min(block.top,(block.top+block.bottom)/2-usable*this.Profile.anchor/100))
            }
            this.ScrollTo(Math.max(0,Math.min(maximumScrollTop,target)))
            return
        }
		if (activeVocals.length > 1 && !this.AutoScrollBlocked) {
			const bounds = activeVocalGroups.flatMap(g => g.Group.Vocals.filter(v => v.IsActive()).map(v => {
                return this.VoiceBounds.get(v)!
			}))
			const target = overlapScrollTarget(bounds, this.ScrollerObject.clientHeight, currentScrollTop, maximumScrollTop)
			// Stop an already-running smooth scroll when both lines now fit.
			// Otherwise its old destination can scroll an active line out of view.
            this.AutoScrolling = true
            this.ScrollerObject.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior })
            this.ArmProgrammaticEnd()
			return
		}

		// Now determine our center
		let center = 0, totalHalfHeight = 0
		for(const activeVocalGroup of activeVocalGroups) {
			totalHalfHeight += activeVocalGroup.Dimensions.Height
			center += activeVocalGroup.Dimensions.Center
		}
		center /= activeVocalGroups.length

		// First determine if we're even past our minimum distance yet
		let scrollY: (number | undefined)
		if (
			this.AutoScrollBlocked
			|| (center > minimumDistanceToAutoScroll)
		) {
			// Now handle potentially unblocking auto-scrolling
			if (this.AutoScrollBlocked) {
				// Check if our center is on-screen
				if (
					(center >= (currentScrollTop - totalHalfHeight))
					&& (center <= (currentScrollTop + scrollViewportHeight))
				) {
					this.ToggleAutoScrollBlock(false)
					this.DetermineLyricBlur()
					if (activeVocals.length > 1) {
						this.QueueActiveMove()
						return
					}
				}
			}

			// Now if we are not blocked we can proceed
			if (this.AutoScrollBlocked === false) {
				// Set our scroll to the distance from the minimum
				scrollY = ((center - viewportCenter) + lyricsContainerMarginTop + offset)
			}
		} else if (currentScrollTop > 0) {
			scrollY = 0
		}

		// Now set our scroll position (hopefully)
		if (scrollY !== undefined) {
			this.ScrollTo(scrollY)
		}
	}

	private ScrollTo(yPosition: number) {
		this.AutoScrolling = true
        const behavior = this.ForceInstant || this.Profile.transition === "instant" ? "instant" : this.Profile.transition === "smooth" ? "smooth" : "auto"
        this.ScrollerObject.scrollTo({ top: yPosition, behavior: behavior as ScrollBehavior })
        this.ArmProgrammaticEnd()
	}

	// Public Methods
	public SetLyricsEnded(ended: boolean) {
		this.LyricsEnded = ended
	}

	public ForceToActive(skippedByVocal?: true) {
		if (this.LyricsAreSynced === false) {
			return
		}
        if (!this.Profile.follow && !skippedByVocal) return
        if (!skippedByVocal && this.AutoScrollBlocked && this.Profile.resume === "delay") return
        // This explicit move also consumes activity already queued by the same
        // seek/click. A second microtask must not replace its chosen transition.
        this.MoveGeneration++;this.MoveQueued=false
        this.ExplicitClick = !!skippedByVocal
        this.ForceInstant = !skippedByVocal && this.Profile.transition === "classic"

		this.ToggleAutoScrollBlock(false)

		if (skippedByVocal) {
			this.Maid.Clean("ForceToActiveCSS")
		} else {
			this.ScrollContainer.classList.add("InstantScroll")
			this.Maid.Give(
				Defer(() => this.ScrollContainer.classList.remove("InstantScroll")),
				"ForceToActiveCSS"
			)
		}

		this.MoveToActiveLyrics()
        this.ExplicitClick = false; this.ForceInstant = false
	}

	public ForceToTop() {
		this.ToggleAutoScrollBlock(false)
		this.ScrollTo(0)
	}

	public Destroy() {
		this.CancelProgrammaticScroll()
        this.MoveGeneration++;this.MoveQueued=false
		this.Maid.Destroy()
	}
}
