# Just Enough Lyrics local build notes

## Runtime and sources
The root npm build produces one self-contained browser extension. Spotify transport
uses the signed-in client's Cosmos service; it never sends Spotify credentials to
external lyric services. The Spotify adapter accepts LINE_SYNCED/UNSYNCED JSON,
converts milliseconds, and infers display boundaries from the next event because
sampled source end times were zero. It does not fabricate word timing. Canonical
track IDs are tried only after absence, not after access errors.

Every enabled source shares the song-change debounce and demand gate. Source
failures are isolated, although the UI still waits for all attempted sources.
Word timing outranks line timing; more distinct starts rank word-timed candidates.
Line-only selection uses fixed source preference rather than line count. Use the
picker to override it. Local files use metadata lookup, not made-up Spotify IDs.

## Cache behavior (current, not the planned redesign)
Musixmatch and transformed lyrics use inherited calendar-month expiry, not 30 days.
AMLL, LRCLIB and Spotify records use two weeks rounded to midnight. Missing records
can be cached too. Expired entries are ignored rather than proactively deleted.
Credentials and preferences are separate from lyric records. There is no clear-all
or per-track clear button yet. Those changes remain planned.
Transformed cache version 4 stores source preparation only, excluding annotations
and synthetic cues; provider cache versions are unchanged. Derived annotations
use a separate bounded memory cache keyed by immutable identity, actual content,
effective language/form options and converter version.

## UI and language processing
Settings are event-driven. Disabling the sidebar cleans up its observers/card.
The sidebar card also has a separate collapsed/expanded state and is hidden while
our main lyric view is open. Its integration still depends on Spotify's DOM.
Now Playing mount/remount detection watches relevant child-list changes within
the sidebar, coalescing checks and retaining the renderer when its anchor is
unchanged. Disabling Now Playing removes the card and disconnects its watchers.
The settings modal uses centered headings, tiles and keyboard-accessible switches.
Now Playing and Full Lyrics have versioned independent language preferences.
Each view's Alternate text master switch gates its remembered language choices;
the settings modal nests those choices inside a connected collapsible card.
Presentation schema 3 reads schemas 1/2, retaining effective language/master values
and defaulting the new Japanese text form to Romaji. Schema 1 infers its master
from selected languages; schema 2 retains its explicit master. Schema 3 remembers
Romaji/Kana independently per view, including while the master is Off. Future
schemas remain read-only rather than being overwritten by an older build.
Legacy shared values seed both profiles; the legacy store remains available for
rollback. Presentation changes do not invalidate provider results; sidebar and
fetch-mode changes update consumer demand without discarding completed choices.
Original text is available immediately. Source preparation only detects language/
availability; it starts no converter or tokenizer. An active view requests selected
alternate text through shared cancellable leases. Closing the view or turning the
feature Off releases its demand; cancelled/stale results cannot replace new text.
Cancellation is cooperative: an already executing synchronous tokenizer cannot be
interrupted, but remaining queued voices and stale installation are stopped.

Japanese primary text can use contextual Romaji or Kana readings. Token surfaces
are matched sequentially to source ranges, preserving gaps and all backing voices;
uncertain alignment or conversion errors retain Original. Mapped readings keep
their original interval union and freeze through source gaps, without invented
phoneme timings. Ruby, secondary rows and translation remain later work.

Safe provider boundaries retain their timing granularity. Cross-span graphemes
coalesce where necessary; Thai does not split marks into separately animated
letters, and joining scripts use conservative shaping words. Voice/scroller
identity survives text replacement, preserving manual-scroll grace. These changes
are not universal script/font certification or measured CPU/GPU speedup claims.

Implementation sources: `Extension/Source/Modules/TextLayout.ts`,
`AnnotationService.ts` and `AnnotationConverters.ts`; immutable source preparation
in `LyricDocument.ts` and `Player/LyricUtilities.ts`; renderer component projection
updates plus `PresentationSettings.ts`/`ProviderControls.ts` for schema/UI scope.
The modal uses compact labels and question-mark help with Classic footer values;
shared delay is under Behavior and each view adds its own signed offset.

## Build and compatibility
Use `npm ci`, `npm test`, `npm run build` at the root. Node 20+ is needed to build;
Spotify runs the emitted file without npm. The Windows installer backs up config
and the previous bundle under ignored local-backups, preserving the selected theme.
On other platforms use the manual instructions in README.md.
Canonical artifacts use `just-enough-lyrics.mjs`; old output paths contain complete
compatibility builds with the same startup guard. The installer identifies local
fork files before removing registrations, stages/hash-checks the new bundle, and
restores the config/bundle on failure. It leaves old local files available for
rollback. It does not change helper CLI commands, state directories or startup tasks.
The Deno task aliases delegate to these npm commands. Inherited build/release
implementation files are historical and are not used by the supported local build;
their old hosted-release configuration is not read by the emitted extension.

Development notes and old session reports are not installation instructions.
No long-term GPU/memory benchmark or complete cross-platform runtime certification
is claimed. The current build retains upstream rendering work and animation loops.
