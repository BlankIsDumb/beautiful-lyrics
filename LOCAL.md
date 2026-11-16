# Just Enough Lyrics local build notes

Current local build is **5.1.0-local.39**. See [VALIDATION.md](VALIDATION.md) for
build and installation evidence. Pass 6 typography, context and
following controls live under Lyrics → Now Playing / Full Lyrics. Fullscreen/cinema and the ordinary lyrics page share Full Lyrics typography,
context and scrolling. Horizontal spacing alone has three independent surfaces.

Easing changes the curve between effect keyframes. Response changes how quickly
scale, vertical motion and glow reach their targets. Direct applies the current
target immediately. Whole-line display uses the viewer’s Line profile for all
text effects, including word-timed songs displayed as Line. Its reading effects
can inherit that profile or use the independent Line reading override.

Show dots for last (s) limits how long eligible gaps display dots. Leave it blank
to show the full eligible gap. The window still ends just before the next vocal.

## Typography, context and following

The lyric font family is shared; empty follows Spotify or the active theme.
Primary size is a per-view .5–2 multiplier over the complete responsive default,
initially 1×. Backing size is .5–1 of primary, initially .75×. Both controls show
current CSS pixels; resizing never saves a pixel snapshot. Weight, source leading,
group gap have their units/ranges explained by the help buttons.

Horizontal adjustment is independently saved for Sidecard, Ordinary lyrics page
and Fullscreen/cinema: −100 is the widest protected column, 0 the existing default,
+100 the narrowest (four primary em in the actual source where possible). It changes
column width without changing font/query-container size. Card padding and fullscreen
artwork/control reservation remain protected; the page can use its lyric viewport.
Readouts report physical column gaps/width in CSS pixels, not glyph ink edges.
Dragging previews without writing storage; release/confirmed number commits, Escape
or closing cancels. Typography reset also resets that viewer's spacing surfaces.

Schema 11 adds animation presets and the gap-dot window. Older schemas migrate
on the first changed save, which backs up the exact prior payload under
JustEnoughLyrics/Presentation/Migration/schemaN. Existing appearance and spacing
choices carry forward. Recovery copies are collision-safe and a failed save
leaves the prior settings active. For rollback after a schema 11 save, pair the
prior bundle with its corresponding settings backup. Future schemas open read-only.

Context counts logical source groups. All active groups and every group between
them form one block, with before/after counts outside it. Readings, backing rows,
wrapped rows and gap dots do not consume counts. Silence retains the preceding
context; before the first vocal it uses the first group. Context hiding preserves
scroll extents and suspends excluded visual work. Manual browsing and Auto-follow
Off reveal the entire song while remembering counts. Outside context can instead
show static muted lyrics, immediately clickable by mouse or keyboard. Blur (CSS
pixels), darkening (brightness toward black) and opacity are independent. Hover or
focus raises opacity to at least60% while retaining the chosen effects; zero
opacity hides nonfocused hit targets. Reading opacity, including zero, remains
independent. Focus alone never starts excluded timing animation. Reset Context
restores All/All and Hide together. Distance gradient is deferred after private
profiling; no gradient controls or persisted placeholder are shipped.

Auto-follow Off leaves playback/external seeks stationary. Clicking lyrics still
seeks/recenters once, including paused clicks and asynchronous Spotify seeks.
Following supports Classic, instant and native smooth transitions; manual input
cancels smooth movement. The anchor is adjustable from 0–100%. The Sidecard
defaults to 0% (readable top), zero preceding groups and all following groups.
The lyrics page and fullscreen default to 45% with all context. Existing saved
values are kept. The Sidecard clamps to actual song edges using its 8 CSS px
inner fades and the measured end of the final lyric group:
short songs stay at the top, and later lines stop at the natural bottom. Context
edges do not create a shorter song. Ordinary page/fullscreen retain their existing
edge anchor space. Within the available physical range, every newly active source block reaches that anchor,
even if already visible. Extreme anchors are constrained to keep active blocks
readable. Active voices stay visible together when possible; newest source voice
wins when the union cannot fit, and an oversized voice aligns at the readable top
without panning through its words. Ordinary silence/ending hold; initial navigation
or external seeks into silence use the preceding source span (first before vocals).
Classic transition and resume remain independent of position. Classic
resume is initially selected; After delay resumes after the last manual input,
waiting for a target during silence. Typography/width reflow preserves the readable-top source anchor while browsing
and while follow is Off. Please test horizontal limits/readouts at narrow/wide
window sizes and when moving between monitors.

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
Presentation schema 8 reads schemas 1–7. Each view owns independent Word/Line
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

Source precision and the Word Text detail preference determine the display mode.
Line-precision Syllable wrappers always use a whole-line projection. Word sources
projected as Line use the same viewer’s Line profile and reading override. Untimed
sources stay plain, without animated state or a clock subscription. Appearance edits
affect the active profile only and reuse source data, annotation leases and voice roots.

Cue candidates derive once from the union of all real voice envelopes. A separate
view event reconciles threshold/motion without rebuilding voices or resetting
manual-scroll grace. Zero disables dots; positive thresholds compare the full gap
before the lead-out subtraction. Tiny gaps use a bounded positive interval and
static dots when inherited animation points would cross. Disabled slots have no
cue child/springs/continuous work, layout margins or blur-distance contribution.
Minimal stops text-effect work; universal cue motion and background remain separate.
The existing clock/transport is unchanged, not a whole-app idle claim.

The conversion model introduced in schema7 stores one enabled conversion and
placement per language in each view.
Japanese Romaji/Kana may replace the main text or appear above the original;
Furigana always remains attached above kanji, remembering the last row placement.
Chinese pinyin and Korean romaja use the same Replace/Above choices. Conversion
Off retains preferences while releasing that view's work. Schemas6/7 are read lazily:
the exact raw payload is retained under `JustEnoughLyrics/Presentation/Migration/schema6`
or `schema7` before the first actual save. Per-language migration prefers effective primary
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

Each display mode can inherit its text effects or independently configure reading
highlight, scale, motion, glow and inactive blur. Character emphasis is disabled
for mapped readings. Per-view relative row/ruby sizes, row gap, letter spacing,
opacity and alignment reuse completed conversion results. Edits to an inactive
reading override are remembered without updating visible readings. Adding another
requested form retains an unchanged pending primary lease/result; closing or
disabling releases obsolete demand.
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
batch. One renderer-owned font-completion listener invalidates source wrapping
and reading layout, including source-only custom fonts, and disconnects on disposal. It is
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
