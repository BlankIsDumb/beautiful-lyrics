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
import { fixedAnchorTarget, edgeSpace, naturalEdgeSpace, readableViewport } from "./FollowPosition.mjs"
import { ResolveHorizontalSpacing, SetHorizontalMeasurement, type HorizontalSurface } from "../../HorizontalSpacing.ts"

// Types
type VocalGroup<V extends (BaseVocals | SyncedVocals)> = {
	GroupContainer: (HTMLDivElement | HTMLButtonElement),
	Vocals: V[]; Role?: "source" | "cue"
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
	private GroupDimensions: { Top: number; Bottom: number }[] = []
    private VoiceBounds = new Map<SyncedVocals,{top:number;bottom:number;start:number;group:number;voice:number}>()
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
    private Destination?: number
    private NavigationPending = false
    private PrimaryElement?: HTMLElement
    private HasOpposite = false
    private MeasuredSizes = new Map<Element,{width:number;height:number}>()
    private Leading = 0
    private Trailing = 0
    private HoldingExtra = false
    private LeadingSpacer?: HTMLDivElement
    private TrailingSpacer?: HTMLDivElement

	// Constructor
	public constructor(
		scrollContainer: HTMLDivElement, lyricsContainer: HTMLDivElement,
		vocalGroups: VocalGroups<V>, lyricsAreSynced: boolean, private BlurEnabled = true, private counters?: RenderingCounters,
        private options: { profile?: LayoutProfile; browsing?: (browsing: boolean) => void; measured?: () => void; surface?: HorizontalSurface; spacing?: () => number; reservation?: HTMLElement; navigationTargets?: () => readonly HTMLElement[] } = {}
	) {
		this.Profile = { ...ClassicLayout, ...options.profile }
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
        this.HasOpposite=vocalGroups.some(group=>group.GroupContainer.classList.contains("AlignedOpposite"))

		// Spacers belong to Simplebar content, outside the font query container.
        if (lyricsAreSynced) {
            const content = this.Scroller.getContentElement()!
            for (const leading of [true,false]) {
                const spacer=document.createElement("div");spacer.className="JEL-FollowSpace";spacer.inert=true;spacer.setAttribute("aria-hidden","true");
                if(leading){content.insertBefore(spacer,lyricsContainer);this.LeadingSpacer=spacer}else{lyricsContainer.after(spacer);this.TrailingSpacer=spacer}
                this.Maid.Give(()=>spacer.remove())
            }
        }
        // On scroll, block auto-scrolling
		this.WatchAutoScrollBlocking()

		// Watch for size changes
		const resizeObserver = this.Maid.Give(
			new ResizeObserver(
                entries => {
                    // Column/wrapping writes can deliver RO after their final
                    // geometry was already measured in this batch. Supplied box
                    // sizes let that common callback stay cheap and avoid a
                    // second full annotation/source traversal.
                    if(!this.GeometryValid || entries.some(entry=>{
                        const box=entry.borderBoxSize[0], measured=this.MeasuredSizes.get(entry.target)
                        return !box || !measured || Math.abs(box.inlineSize-measured.width)>.01 || Math.abs(box.blockSize-measured.height)>.01
                    }))this.QueueLayoutMeasure()
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
            if (this.LyricsAreSynced && !(preserve && this.AutoScrollBlocked)) { this.MoveToActiveLyrics(); this.ExplicitClick=false;this.ForceInstant=false }
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
        if (profile.follow && (!old.follow || old.anchor !== profile.anchor)) this.QueueLayoutMeasure()
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
            this.MoveGeneration++;this.MoveQueued=false
            this.NavigationPending=false;this.ExplicitClick=false;this.ForceInstant=false
            this.PreserveManualGrace=true
            this.CancelProgrammaticScroll()
            this.ToggleAutoScrollBlock(true)
            this.PendingResume = false
            this.LastManualAt=performance.now()
            this.ArmManualResume()
        }
        const callback = () => {
            if (this.AutoScrolling) this.ArmProgrammaticEnd()
            else {
                // Native keyboard focus may scroll a visible muted button into
                // view. Focus alone must not turn its static text into an All
                // context animation window. Explicit wheel/touch/key/track input
                // already enters manual mode before its resulting scroll event.
                const focused=document.activeElement?.closest(".ContextMuted")
                if(focused && this.LyricsContainer.contains(focused))return
                manual()
            }
        }
        const key = (event: KeyboardEvent) => {
            if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return
            if (["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"," "].includes(event.key)) manual()
        }
        const pointer = (event: PointerEvent) => {
            if ((event.target as HTMLElement)?.closest(".simplebar-track")) manual()
        }
        const end = () => { this.Destination=undefined; this.AutoScrolling = false; this.Maid.Clean("WaitForAutoScroll") }
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
        this.Maid.Give(Timeout(.2, () => { this.AutoScrolling = false; this.Destination=undefined }), "WaitForAutoScroll")
    }
    private CancelProgrammaticScroll() {
        if (this.AutoScrolling) this.ScrollerObject.scrollTo({ top: this.ScrollerObject.scrollTop, behavior: "instant" as ScrollBehavior })
        this.AutoScrolling = false
        this.Destination=undefined
        this.Maid.Clean("WaitForAutoScroll")
    }

	private HandleLyricActiveStateChanges() {
		for(const vocalGroup of this.VocalGroups as VocalGroups<SyncedVocals>) {
			for(const vocal of vocalGroup.Vocals) {
				this.Maid.Give(
					vocal.ActivityChanged.Connect(() => { if(vocalGroup.Role === "cue")this.QueueLayoutMeasure(); this.QueueActiveMove() })
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
			if (!this.Maid.IsDestroyed() && !this.LayoutQueued && !(this.PreserveManualGrace && this.AutoScrollBlocked)) this.MoveToActiveLyrics(true)
		})
	}

	private UpdateLyricHeights() {
		if (!this.LyricsContainer.isConnected || this.ScrollContainer.clientWidth <= 0 || this.ScrollContainer.clientHeight <= 0) {
            this.GeometryValid=false
            SetHorizontalMeasurement(this.LyricsContainer)
            if(this.LyricsContainer.dataset.columnAvailable!=="false") { this.LyricsContainer.dataset.columnAvailable="false";this.options.measured?.() }
            return
        }
        const oldScroll=this.ScrollerObject.scrollTop
        const naturalCard=this.options.surface === "Card"
        const readableTop=readableViewport(this.ScrollerObject.clientHeight,this.Profile.anchor,naturalCard)?.safeTop ?? 0
        const readingIndex=this.AutoScrollBlocked || !this.Profile.follow ? this.GroupDimensions.findIndex((group,index)=>this.VocalGroups[index].Role!=="cue" && group.Bottom>oldScroll+readableTop) : -1
        const readingOffset=readingIndex>=0 ? oldScroll-this.GroupDimensions[readingIndex].Top : 0
        if(!this.MeasureHorizontalColumn()){this.GeometryValid=false;this.options.measured?.();return}
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
        let totalHeight = 0
        let cardScale: number | undefined
        if (naturalCard) {
            const port = this.ScrollerObject
            cardScale = port.getBoundingClientRect().height / parseFloat(getComputedStyle(port).height) || 1
            const last = this.VocalGroups.findLast(group => !group.GroupContainer.hidden)?.GroupContainer
            if (last) {
                // A sum of rounded group heights can undershoot the final line.
                // Measure the actual flow end before setting the paint clip.
                const end = (last.getBoundingClientRect().bottom - this.LyricsContainer.getBoundingClientRect().top) / cardScale
                totalHeight = Math.ceil(end + (parseFloat(getComputedStyle(last).marginBottom) || 0))
            }
        } else {
            for (const { GroupContainer } of this.VocalGroups) totalHeight += GetTotalElementHeight(GroupContainer)
        }

		// Update our container height
        const height=`${totalHeight}px`
        if(this.LyricsContainer.style.height!==height)this.LyricsContainer.style.height=height
		this.Scroller.recalculate()
        const frame=this.ScrollerObject.getBoundingClientRect()
        const scale=cardScale ?? (frame.height/this.ScrollerObject.clientHeight || 1)
        const containerRect=this.ScrollContainer.getBoundingClientRect()
        this.MeasuredSizes.set(this.ScrollContainer,{width:containerRect.width/scale,height:containerRect.height/scale})
        const scrollTop=this.ScrollerObject.scrollTop
        const lyricsTop=(this.LyricsContainer.getBoundingClientRect().top-frame.top)/scale+scrollTop
        this.VoiceBounds.clear()
        for(const [index,group] of (this.VocalGroups as VocalGroups<SyncedVocals>).entries()) {
            const rect=group.GroupContainer.getBoundingClientRect()
            this.MeasuredSizes.set(group.GroupContainer,{width:rect.width/scale,height:rect.height/scale})
            const top=(rect.top-frame.top)/scale+scrollTop,bottom=(rect.bottom-frame.top)/scale+scrollTop
            this.GroupDimensions[index] = { Top: top, Bottom: bottom }
            for(const [voice,vocal] of group.Vocals.entries()) {
                const target=vocal.GetScrollTarget?.(),bounds=(target?.Element??group.GroupContainer).getBoundingClientRect()
                this.VoiceBounds.set(vocal,{top:(bounds.top-frame.top)/scale+scrollTop,bottom:(bounds.bottom-frame.top)/scale+scrollTop,start:target?.StartTime??0,group:index,voice})
            }
        }
        const viewport=readableViewport(this.ScrollerObject.clientHeight,this.Profile.anchor,naturalCard)
        this.GeometryValid = !!viewport
        if(this.LyricsAreSynced && viewport) {
            const all=[...this.VoiceBounds.values()].filter(bound=>bound.bottom>bound.top)
            const neutral=all.map(bound=>({...bound,top:bound.top-this.Leading,bottom:bound.bottom-this.Leading}))
            const style=getComputedStyle(this.LyricsContainer)
            // Flow extent is independent of Simplebar's viewport min-height.
            const intrinsic=lyricsTop-this.Leading+this.LyricsContainer.getBoundingClientRect().height/scale+(parseFloat(style.marginBottom)||0)
            const extent=naturalCard ? naturalEdgeSpace(neutral,this.ScrollerObject.clientHeight,intrinsic) : edgeSpace(neutral,this.ScrollerObject.clientHeight,this.Profile.anchor,intrinsic)
            if(extent) {
                const active=(this.VocalGroups as VocalGroups<SyncedVocals>).some(group=>group.Vocals.some(v=>v.IsActive()))
                // Other surfaces retain their held follow range when cues disappear.
                // Card must allow natural range shrink instead of keeping a blank tail.
                const trailing=!naturalCard && !active && !this.NavigationPending && readingIndex<0 ? Math.max(extent.trailing,Math.ceil((this.Destination??oldScroll)+this.ScrollerObject.clientHeight-intrinsic-extent.leading)) : extent.trailing
                this.HoldingExtra=trailing>extent.trailing
                const delta=extent.leading-this.Leading
                if(delta || trailing!==this.Trailing) {
                    this.Leading=extent.leading;this.Trailing=trailing
                    this.LeadingSpacer!.style.height=`${this.Leading}px`;this.TrailingSpacer!.style.height=`${trailing}px`
                    for(const bounds of this.VoiceBounds.values()){bounds.top+=delta;bounds.bottom+=delta}
                    for(const dimensions of this.GroupDimensions){dimensions.Top+=delta;dimensions.Bottom+=delta}
                    this.Scroller.recalculate()
                }
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
        if (!this.LyricsAreSynced) return
        if (redetermineBlur) this.DetermineLyricBlur()
        if ((!this.Profile.follow && !this.ExplicitClick) || !this.GeometryValid || this.LayoutQueued) return
        const groups=this.VocalGroups as VocalGroups<SyncedVocals>
        const collect=(role: "source" | "cue")=>groups.flatMap(group=>(group.Role??"source")===role ? group.Vocals.filter(v=>v.IsActive()).map(v=>this.VoiceBounds.get(v)!).filter(Boolean) : [])
        let bounds=collect("source")
        if(!bounds.length)bounds=collect("cue")
        if(!bounds.length && this.NavigationPending && !this.AutoScrollBlocked) {
            const targets=new Set(this.options.navigationTargets?.()??[])
            bounds=groups.flatMap(group=>targets.has(group.GroupContainer) ? group.Vocals.map(v=>this.VoiceBounds.get(v)!).filter(Boolean) : [])
        }
        this.NavigationPending=false
        if(!bounds.length)return // Ordinary silence and the ending hold their viewport.
        if(this.AutoScrollBlocked) {
            if(this.Scroller.isScrolling)return
            if(this.Profile.resume==="delay") { if(performance.now()<this.ManualDeadline)return }
            else {
                // Classic retains its reach condition, then uses the same anchor.
                const top=Math.min(...bounds.map(b=>b.top)),bottom=Math.max(...bounds.map(b=>b.bottom))
                const center=(top+bottom)/2,current=this.ScrollerObject.scrollTop
                if(center<current-(bottom-top)/2 || center>current+this.ScrollerObject.clientHeight)return
            }
            this.PendingResume=false;this.ToggleAutoScrollBlock(false)
        }
        const target=fixedAnchorTarget(bounds,this.ScrollerObject.clientHeight,this.Profile.anchor,this.ScrollerObject.scrollHeight-this.ScrollerObject.clientHeight,this.options.surface === "Card")
        if(target!==undefined)this.ScrollTo(target)
    }

    private MeasureHorizontalColumn() {
        if(!this.options.surface || !this.options.spacing)return true
        const root=this.LyricsContainer, rect=root.getBoundingClientRect(), scroll=this.ScrollerObject.getBoundingClientRect()
        const scale=rect.width/root.offsetWidth || 1
        const style=getComputedStyle(root)
        // The canonical source root survives annotation/detail reflow. Resolve it
        // once rather than querying timed descendants on every resize batch.
        const primary=this.PrimaryElement?.isConnected ? this.PrimaryElement : root.querySelector<HTMLElement>(".Vocals.Lead:not(.AnnotationText):not(.RubyReading),.Vocals:not(.AnnotationText):not(.RubyReading)")
        if(primary)this.PrimaryElement=primary
        const reservation=this.options.reservation?.getBoundingClientRect()
        const safeLeft=this.options.surface==="Fullscreen" ? reservation && reservation.width>0 ? Math.max(rect.left,Math.min(rect.right,reservation.right)) : NaN : Math.max(rect.left,scroll.left)
        const result=ResolveHorizontalSpacing({rootLeft:rect.left/scale,rootRight:rect.right/scale,
            defaultLeft:rect.left/scale+(parseFloat(style.paddingLeft)||0),defaultRight:rect.right/scale-(parseFloat(style.paddingRight)||0),
            safeLeft:safeLeft/scale,safeRight:Math.min(rect.right,scroll.right)/scale,
            primary:primary?parseFloat(getComputedStyle(primary).fontSize):0,fontFraction:this.HasOpposite ? .75 : .95,adjustment:this.options.spacing()})
        const available=String(!!result)
        if(root.dataset.columnAvailable!==available)root.dataset.columnAvailable=available
        SetHorizontalMeasurement(root,result)
        if(!result)return false
        const limited=String(result.limited)
        if(root.dataset.columnLimited!==limited)root.dataset.columnLimited=limited
        const defaultLeft=rect.left/scale+(parseFloat(style.paddingLeft)||0),defaultRight=rect.right/scale-(parseFloat(style.paddingRight)||0)
        const adjusted=Math.abs(result.left-defaultLeft)>.01 || Math.abs(result.right-defaultRight)>.01
        // Stock0 (and a request already at its outward limit) retains the exact
        // original cqw width rules. Rewriting inherited pixel variables during
        // every host resize adds a full subtree restyle without changing layout.
        if(adjusted) {
            const values:Record<string,number>={"--jel-column-left":result.left-defaultLeft,"--jel-column-right":defaultRight-result.right,"--jel-column-width":result.width}
            for(const [property,value] of Object.entries(values)){const next=`${value}px`;if(root.style.getPropertyValue(property)!==next)root.style.setProperty(property,next)}
        } else {
            for(const property of ["--jel-column-left","--jel-column-right","--jel-column-width"])if(root.style.getPropertyValue(property))root.style.removeProperty(property)
        }
        if(root.classList.contains("HorizontalColumn")!==adjusted)root.classList.toggle("HorizontalColumn",adjusted)
        return true
    }

	private ScrollTo(yPosition: number) {
        if(!this.ExplicitClick && Math.abs(yPosition-(this.Destination??this.ScrollerObject.scrollTop))<=.5)return
        this.Destination=yPosition
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
        this.NavigationPending=true
        if(this.HoldingExtra)this.QueueLayoutMeasure()
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
        if(!this.LayoutQueued && this.GeometryValid){this.ExplicitClick = false; this.ForceInstant = false}
	}

	public ForceToTop() {
		this.ToggleAutoScrollBlock(false)
		this.ScrollTo(0)
	}

	public Destroy() {
		this.CancelProgrammaticScroll()
        this.MoveGeneration++;this.MoveQueued=false
		this.Maid.Destroy()
        SetHorizontalMeasurement(this.LyricsContainer)
	}
}
