import "./style.scss"
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { SongLyrics } from "@Spices/Spicetify/Services/Player/mod.ts"
import BackgroundController from "../../Modules/Background/BackgroundController.ts"
import LyricsRenderer from "../../Modules/LyricsRenderer.ts"
import { CreateElement } from "../Shared.ts"
import { PresentationSettings } from "../../PresentationSettings.ts"
import { BuildProviderCredit, BuildProviderCreditDOM } from "../../ProviderCredit.ts"

const CardContainer = `
  <div id="BeautifulLyrics-CardView">
    <div class="Header" data-encore-id="type">
      <div class="Title">Lyrics</div>
      <div class="BL-CardCredit"><span class="BL-CardCreditLine"></span></div>
    </div>
  </div>
`
const LyricsContainer = `<div class="LyricsContent"><div class="ContentContainer"></div></div>`

export default class CardView implements Giveable {
  private readonly Maid = new Maid()
  private readonly Container: HTMLDivElement

  constructor(insertAfter: HTMLDivElement) {
    this.Container = this.Maid.Give(CreateElement<HTMLDivElement>(CardContainer))
    this.Container.dataset.cardHeight = PresentationSettings.getLayout("NowPlaying").cardHeight
    this.Maid.Give(PresentationSettings.subscribeLayout((view, fields) => {
      if (view === "NowPlaying" && fields.includes("cardHeight")) {
        this.Container.dataset.cardHeight = PresentationSettings.getLayout("NowPlaying").cardHeight
      }
    }))

    const header = this.Container.querySelector<HTMLDivElement>(".Header")!
    const creditElement = header.querySelector<HTMLDivElement>(".BL-CardCredit")!
    // The view owner replaces this card on SongLyricsLoaded/provider switches.
    const credit = BuildProviderCredit(SongLyrics)
    creditElement.hidden = !credit
    // Links belong to the credit, even if a host later adds a header action.
    creditElement.addEventListener("click", event => event.stopPropagation())
    const fitCredit = () => {
      if (!credit || this.Maid.IsDestroyed()) return
      const line = document.createElement("span")
      line.className = "BL-CardCreditLine"
      line.append(BuildProviderCreditDOM(credit, "card"))
      creditElement.dataset.rows = "1"
      creditElement.replaceChildren(line)
      // Measure the actual single-line content once. Observing only the header
      // prevents our own row switch from feeding back into another fit pass.
      if (credit.people.length && line.scrollWidth > creditElement.clientWidth) {
        creditElement.dataset.rows = "2"
        line.replaceChildren(BuildProviderCreditDOM(credit, "provider"))
        const people = document.createElement("span")
        people.className = "BL-CardCreditPeople"
        people.append(BuildProviderCreditDOM(credit, "people"))
        creditElement.append(people)
      }
    }
    let headerWidth: number | undefined
    const resize = this.Maid.Give(new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width === undefined || width === headerWidth) return
      headerWidth = width
      fitCredit()
    }))
    resize.observe(header)
    // A disposed card must not be touched by the deferred font-ready callback.
    void document.fonts.ready.then(fitCredit)

    const lyricsContainer = this.Maid.Give(CreateElement<HTMLDivElement>(LyricsContainer))
    const content = lyricsContainer.querySelector<HTMLDivElement>(".ContentContainer")!
    this.Container.append(lyricsContainer)
    const renderer = this.Maid.Give(new LyricsRenderer(content, SongLyrics!,
      SongLyrics!.RomanizedLanguage === undefined ? false : PresentationSettings.isRomanized("NowPlaying", SongLyrics!.RomanizedLanguage),
      "NowPlaying", undefined, undefined, {surface:"Card"}), "LyricsRenderer")
    const background = this.Maid.Give(new BackgroundController(this.Container, {view:"NowPlaying", surface:"Card"}))
    insertAfter.after(this.Container)
    // The collapsed rail can leave a sliver intersecting the viewport.
    // Measure width separately so vertical scrolling can leave the card active.
    const visibility = new IntersectionObserver(entries => {
      if (this.Maid.IsDestroyed()) return
      const entry = entries[entries.length - 1]
      if (!entry) return
      const {boundingClientRect, intersectionRect, isIntersecting} = entry
      const onScreen = isIntersecting && boundingClientRect.width > 0
        && intersectionRect.height > 0 && intersectionRect.width >= 0.5 * boundingClientRect.width
      renderer.SetOnScreen(onScreen)
      background.SetOnScreen(onScreen)
    }, {root:null, threshold:Array.from({length:21}, (_, index) => index / 20)})
    this.Maid.Give(() => visibility.disconnect())
    visibility.observe(this.Container)
    fitCredit()
  }

  public Destroy() { this.Maid.Destroy() }
}
