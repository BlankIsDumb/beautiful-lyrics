import type { HorizontalSurface } from "../../HorizontalSpacing.ts";
// Web-Modules
import { Maid } from "@Universal/Modules/Maid.ts"

// Spices
import { Spotify } from "@Spices/Spicetify/Services/Session.ts"
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

	// For external use to combine with romanization toggling
	return UpdateLyricsRenderer
}

// Handle Romanization Toggling for Header button
export const SetupRomanizationButton = (
	romanizationToggle: HTMLButtonElement,
	updateLyricsRenderer: () => void,
	maid: Maid
) => {
	// Create our toggle method
	const ToggleRomanizationState = () => {
		if (PresentationSettings.isReadOnly()) return
		if (SongLyrics?.RomanizedLanguage !== undefined) {
			PresentationSettings.setRomanized(
				"FullLyrics", SongLyrics.RomanizedLanguage,
				!PresentationSettings.isRomanized("FullLyrics", SongLyrics.RomanizedLanguage)
			)
		}
	}

	// Setup behavior and the tooltip
	romanizationToggle.disabled = PresentationSettings.isReadOnly()
	romanizationToggle.addEventListener("click", ToggleRomanizationState)
	maid.Give(() => romanizationToggle.removeEventListener("click", ToggleRomanizationState))
	const romanizeTooltip = Spotify.Tippy(
		romanizationToggle,
		{
			...Spotify.TippyProps,
			content: "__WAITING__"
		}
	)
	maid.Give(() => romanizeTooltip.destroy())

	// Handle updating our state
	const SetContent = (isRomanized: boolean): undefined => {
		romanizeTooltip.setContent(PresentationSettings.isReadOnly()
			? "Update the extension to edit presentation settings"
			: isRomanized ? "Show original text" : "Show alternate text")
		romanizationToggle.innerHTML = (isRomanized ? Icons.EnableRomanization : Icons.DisableRomanization)
	}
	const SetVisibility = (isVisible: boolean): undefined => {
		romanizationToggle.style.display = (isVisible ? "" : "none")
	}

	// Handle our romanization state changing and its initial state
	maid.Give(
		PresentationSettings.subscribe(
			(view, languages) => {
				if (view === "FullLyrics" && SongLyrics?.RomanizedLanguage !== undefined && languages.includes(SongLyrics.RomanizedLanguage)) {
					SetContent(PresentationSettings.isRomanized("FullLyrics", SongLyrics.RomanizedLanguage))
				}
			}
		)
	)

	// Handle updating our state
	{
		const Update = () => {
			if (SongLyrics?.RomanizedLanguage === undefined) {
				SetVisibility(false)
			} else {
				SetContent(PresentationSettings.isRomanized("FullLyrics", SongLyrics.RomanizedLanguage))
				SetVisibility(true)
			}
		}

		Update()
		maid.Give(SongChanged.Connect(Update))
		maid.Give(SongLyricsLoaded.Connect(Update))
	}
}
