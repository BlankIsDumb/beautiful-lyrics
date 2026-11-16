import { SetupProviderControls } from '../../ProviderControls.ts'
// Styles
import "./style.scss"

// Web-Modules
import { Maid, Giveable } from "@Universal/Modules/Maid.ts"
import { Timeout } from "@Universal/Modules/Scheduler.ts"

// Spices
import { SpotifyHistory } from "@Spices/Spicetify/Services/Session.ts"
import { Song, SongChanged } from "@Spices/Spicetify/Services/Player/mod.ts"

// Our Modules
import { CreateLyricsRenderer } from "./Shared.ts"
import { CreateElement } from "../Shared.ts"
import BackgroundController from "../../Modules/Background/BackgroundController.ts"

// Templates
const Container = `
	<div class="BeautifulLyricsPage BeautifulLyricsBackground Contained">
		<div class="Content"></div>
	</div>
`
const NoLyrics = `<span class="NoLyrics">This song doesn't have any Lyrics!</span>`

// Store where we last were before a Page opened
let LastPageLocation: (string | undefined)

// Class
export default class PageView implements Giveable {
	// Private Properties
	private readonly Maid = new Maid()

	// Public Properties
	public readonly Closed = this.Maid.Destroyed

	// Constructor
	constructor(page: HTMLDivElement, isLegacy: boolean) {
		// Determine our last-page
		const lastPage = SpotifyHistory.entries[SpotifyHistory.entries.length - 2]
		if ((lastPage !== undefined) && (lastPage.pathname.startsWith("/BeautifulLyrics") === false)) {
			LastPageLocation = lastPage.pathname
		}

		// Create our container
		const container = this.Maid.Give(CreateElement<HTMLDivElement>(Container))

		// Apply our dynamic background
		this.Maid.Give(new BackgroundController(container, {view:"FullLyrics", surface:"Contained"}))

		// Handle lyric-rendering changes
		const content = container.querySelector<HTMLDivElement>(".Content")!
		CreateLyricsRenderer(content, this.Maid, NoLyrics, {surface:"Contained"})
		SetupProviderControls(content, this.Maid)

		// Now parent our container
		if (isLegacy) {
			page.style.containerType = "inline-size"
			this.Maid.Give(() => page.style.containerType = "")
		}
		page.appendChild(container)

		// Handle watching for no-songs
		{
			const CheckForSongExistence = () => {
				if (Song === undefined) {
					this.Close()
				}
			}

			this.Maid.Give(SongChanged.Connect(CheckForSongExistence))
			this.Maid.Give(Timeout(1, CheckForSongExistence))
		}
	}

	// Public Methods
	public Close() {
		// If we have a last-page then go there
		if (LastPageLocation !== undefined) {
			return SpotifyHistory.push(LastPageLocation)
		}

		// Otherwise, send us home
		SpotifyHistory.push("/")
	}

	// Deconstructor
	public Destroy() {
		this.Maid.Destroy()
	}
}
