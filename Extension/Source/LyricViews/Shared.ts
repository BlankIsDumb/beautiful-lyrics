// Imported Types
import type { RomanizedLanguage } from "@Spices/Spicetify/Services/Player/mod.ts"

// NPM Packages
import seedrandom from "npm:seedrandom"

// Spices
import { GetInstantStore } from "@Spices/Spicetify/Services/Cache.ts"
import {
	Song, SongContext
} from "@Spices/Spicetify/Services/Player/mod.ts"

// Our store
export const Store = GetInstantStore<
	{
		CardLyricsVisible: boolean;
		PlaybarDetailsHidden: boolean;
		RomanizedLanguages: {[key in RomanizedLanguage]: boolean};
	}
>(
	"BeautifulLyrics/LyricViews", 1,
	{
		CardLyricsVisible: false,
		PlaybarDetailsHidden: false,
		RomanizedLanguages: {
			Chinese: false,
			Japanese: false,
			Korean: false,
		}
	}
)

// Shared Methods
export const CreateElement = <E = HTMLElement>(text: string) => {
	const element = document.createElement("div")
	element.innerHTML = text
	return element.firstElementChild as E
}

export const GetCoverArtForSong = (): [string, (number | undefined)] => {
	// DJ is ALWAYS guaranteed to have a cover-art
	if (Song?.Type === "DJ") {
		return [Song.CoverArt.Big, undefined]
	}

	const coverArt = (
		(Song?.Type === "Local")
		? (
			Song?.CoverArt
			?? (
				(SongContext?.CoverArt !== undefined)
				? `spotify:image:${SongContext.CoverArt}`
				: undefined
			)
		)
		: Song?.CoverArt.Big
	)
	if (coverArt === undefined) {
		return [
			"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%23776b9e'/%3E%3C/svg%3E",
			(75 + ((360 - 75) * seedrandom(Song?.Uri)()))
		]
	} else {
		return [coverArt, undefined]
	}
}
