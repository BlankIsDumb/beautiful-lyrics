# Local build notes

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

## UI and language processing
Settings are event-driven. Disabling the sidebar cleans up its observers/card.
The sidebar card also has a separate collapsed/expanded state and is hidden while
our main lyric view is open. Its integration still depends on Spotify's DOM.
Current investigation reproduced a missing card that recovered when the sidebar
option was toggled off/on after Now Playing mounted. Shallow mount observation is
the likely cause; Comfy can display the card once it exists. See VALIDATION.md.
Existing romanization is eager on fresh lyrics even when its display toggle is off;
new annotation modes and failure-tolerant language processing are future work.

## Build and compatibility
Use `npm ci`, `npm test`, `npm run build` at the root. Node 20+ is needed to build;
Spotify runs the emitted file without npm. The Windows installer backs up config
and the previous bundle under ignored local-backups, preserving the selected theme.
On other platforms use the manual instructions in README.md.
The Deno task aliases delegate to these npm commands. Inherited build/release
implementation files are historical and are not used by the supported local build;
their old hosted-release configuration is not read by the emitted extension.

Development notes and old session reports are not installation instructions.
No long-term GPU/memory benchmark or complete cross-platform runtime certification
is claimed. The current build retains upstream rendering work and animation loops.
