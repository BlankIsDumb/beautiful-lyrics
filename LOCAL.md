# Just Enough Lyrics local build notes

Current local build: **5.1.0-local.16**; built, installed and verified in Windows
Spotify. Installed local.15 exposed two presentation
defects: authored flex display overrode hidden conversion style rows, and atomic
ruby's first-baseline propagation placed annotated kanji below plain kana. The
fix enforces hidden display inside the settings form and aligns the last
source baseline of each complete ruby/plain unit. Intrinsic reading width,
horizontal viewport fit and independent per-piece effects are preserved.

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
Presentation schema 6 reads schemas 1–5. Each view owns independent Word/Line
text cases plus universal cue settings, while language/master/Japanese form and
delay remain view-wide. Untouched Classic/Auto v4 text adopts expressive Word and
muted Line defaults; edited/non-Classic presets or detail choices are cloned into
both cases without losing custom values. Old cueAnimation migrates once per view,
separate from text presets. Partial/malformed Line maps use muted defaults. Future
schemas remain read-only. Schema 1 infers its master from languages; schemas
before 3 default Japanese form to Romaji. Remembered Kana/Off choices survive.
Legacy shared values seed both profiles; the legacy store remains available for
rollback. Presentation changes do not invalidate provider results; sidebar and
fetch-mode changes update consumer demand without discarding completed choices.
Original text is available immediately. Source preparation only detects language/
availability; it starts no converter or tokenizer. An active view requests selected
alternate text through shared cancellable leases. Closing the view or turning the
feature Off releases its demand; cancelled/stale results cannot replace new text.
Cancellation is cooperative: an already executing synchronous tokenizer cannot be
interrupted, but remaining queued voices and stale installation are stopped.

Source precision selects the active text case independently of requested display
detail. Line-precision Syllable wrappers always use a whole-line projection; Word
sources projected as Line retain their Word-source case. Untimed sources stay
plain, without animated state or a clock subscription. Render events ignore other
views/inactive cases and retain source data, annotation leases and voice roots.

Cue candidates derive once from the union of all real voice envelopes. A separate
view event reconciles threshold/motion without rebuilding voices or resetting
manual-scroll grace. Zero disables dots; positive thresholds compare the full gap
before the lead-out subtraction. Tiny gaps use a bounded positive interval and
static dots when inherited animation points would cross. Disabled slots have no
cue child/springs/continuous work, layout margins or blur-distance contribution.
Minimal stops text-effect work; universal cue motion and background remain separate.
The existing clock/transport is unchanged, not a whole-app idle claim.

Schema7 stores one enabled conversion and placement per language in each view.
Japanese Romaji/Kana may replace the main text or appear above the original;
Furigana always remains attached above kanji, remembering the last row placement.
Chinese pinyin and Korean romaja use the same Replace/Above choices. Conversion
Off retains preferences while releasing that view's work. Schema6 is read lazily:
the exact raw payload is retained under `JustEnoughLyrics/Presentation/Migration/schema6`
before the first actual save. Per-language migration prefers effective primary
replacement, then Japanese ruby, then the former secondary as Above. Mixed old
choices cannot all be active in the single-conversion model; the snapshot retains
them for recovery. Text cases, cue settings and reading appearance are preserved.

Japanese tokenization normalizes ASCII parentheses for analysis only, with source
boundary mapping restoring the original punctuation. A constrained temporal-noun
pronoun correction addresses the reproduced 君 context; names and ambiguous
placeholders are not globally rewritten. Kana retains written particles while
Romaji uses pronunciation. Unique kana-anchor alignment attaches readings to
kanji, preserving okurigana and grouped compounds. Bounded ambiguous alignment
omits unsafe ruby rather than inventing character readings or phoneme timing.

Each source case can inherit its text effects or independently configure reading
highlight, scale, motion, glow and inactive blur. Character emphasis is disabled
for mapped readings. Per-view relative row/ruby sizes, row gap, letter spacing,
opacity and alignment reuse completed conversion results. Changing the inactive
case does no rendering work. Adding another requested form retains an unchanged
pending primary lease/result; closing or disabling releases obsolete demand.
Ruby bases and readings have separate effect roots under a neutral wrapper, so
one cannot multiply the other's opacity/filter/scale. Safe source character
clipping retains each original timing interval; it never invents token timestamps.
Above/furigana layout uses the existing coalesced group resize measurement and
full combined voice scroll bounds. Async rows and style changes preserve the
existing manual-scroll grace; no additional observer or frame loop was added.
Ruby units contribute their reading's intrinsic width and height; complete units
wrap normally. Annotated fragments isolate the host border-box reset and keep
readings horizontal. A reading wider than its whole voice receives a uniform font
fit while its requested size stays saved. This uses the existing coalesced layout
batch, with one font-completion listener only while readings are present. It is
not a general clipping/overflow fix.

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
shared delay is under Behavior and each view adds its own signed offset. Native
change/input events apply scoped values immediately; invalid partial numeric edits
never reach storage. Completed credential edits use their own setter; behavior
controls cannot rewrite stale password-field contents. The disconnected modal
lifetime aborts all handlers, including after a removed form is reattached.

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
is claimed. Capability-based text scheduling retains the existing clock and
background animation. Spring-enabled Classic compatibility components retain their
local active/settling-voice cadence because the inherited solver's sleep flag does
not mean zero residual velocity; spring-free text work uses indexed boundaries.
