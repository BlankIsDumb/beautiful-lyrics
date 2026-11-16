import type { HorizontalSurface } from "../../HorizontalSpacing.ts";
// Web-Modules
import { Maid } from "@Universal/Modules/Maid.ts"

// Spices
import {
	SongChanged,
	SongLyrics, SongLyricsLoaded, HaveSongLyricsLoaded, SongLyricsError, SongLyricsOutcomes
} from "@Spices/Spicetify/Services/Player/mod.ts"

// Modules
import LyricsRenderer from "../../Modules/LyricsRenderer.ts"

// Our Modules
import Icons from "./Icons.ts"
import {
	CreateElement,
} from "../Shared.ts"
import { PresentationSettings } from "../../PresentationSettings.ts"

// Shared Lyrics Behavior
export const CreateLyricsRenderer = (
	container: HTMLDivElement,
	maid: Maid,
	noLyricsTemplate?: string,
    options: {surface: HorizontalSurface; reservation?: HTMLElement} = {surface:"Contained"},
) => {
	const UpdateLyricsRenderer = () => {
		// Wipe our previous renderer
		maid.Clean("LyricsRenderer")

		// If we don't have lyrics we need to display that
		if (HaveSongLyricsLoaded === false) {
			if (noLyricsTemplate === undefined) {
				container.classList.remove("NoLyrics")
			}

			container.appendChild(maid.Give(CreateElement<HTMLElement>(Icons.LoadingLyrics), "LyricsRenderer"))
		} else if (SongLyrics === undefined && SongLyricsError) {
			// Provider errors are text, never HTML. Keep them distinct from missing lyrics.
			const message = document.createElement("span");
			message.className = "NoLyrics";
			message.textContent = SongLyricsError;
			container.appendChild(maid.Give(message, "LyricsRenderer"));
		} else if (SongLyrics === undefined) {
			const failures = SongLyricsOutcomes.filter(outcome => outcome.State === 'failed');
			let message: HTMLElement | undefined;
			if (noLyricsTemplate === undefined) {
				container.classList.add("NoLyrics")
				// Fullscreen normally centers its play panel without a message.
				// Only partial failures need an explanatory no-lyrics block there.
				if (failures.length) {
					message = document.createElement('span');
					message.className = 'NoLyrics PartialProviderFailure';
					message.textContent = "This song doesn't have any Lyrics!";
					container.appendChild(maid.Give(message, "LyricsRenderer"));
				}
			} else {
				message = CreateElement<HTMLSpanElement>(noLyricsTemplate);
				container.appendChild(maid.Give(message, "LyricsRenderer"));
			}
			if (message && failures.length) {
				const note = document.createElement('small');
				note.className = 'ProviderFailures';
				note.textContent = "Couldn't check: " + failures.map(outcome => `${outcome.Provider} (${outcome.Reason})`).join('; ');
				message.append(note);
			}
		} else { // Otherwise, render our lyrics
			if (noLyricsTemplate === undefined) {
				container.classList.remove("NoLyrics")
			}

			maid.Give(
				new LyricsRenderer(
					container, SongLyrics,
					(
						(SongLyrics.RomanizedLanguage !== undefined)
						&& PresentationSettings.isRomanized("FullLyrics", SongLyrics.RomanizedLanguage)
					), "FullLyrics", undefined, undefined, options
				),
				"LyricsRenderer"
			)
		}
	}
	UpdateLyricsRenderer()
	maid.Give(SongChanged.Connect(UpdateLyricsRenderer))
	maid.Give(SongLyricsLoaded.Connect(UpdateLyricsRenderer))

	// Return the same refresh path for callers that need it.
	return UpdateLyricsRenderer
}
