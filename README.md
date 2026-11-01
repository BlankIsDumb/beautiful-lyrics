# Just Enough Lyrics

A personal fork of [Beautiful Lyrics](https://github.com/surfbryce/beautiful-lyrics).
The aim: keep the animated lyrics, make the extension build locally, and gradually
turn the things you don't want into switches. Some of those switches exist. The
rest are still on the increasingly unreasonable to-do list.

This is an independent fork, not an upstream release. Please report fork problems
here rather than sending the original author bugs from this build.

Current local version: **5.1.0-local.23**. Pass 6 adds shared lyric font-family
selection and per-view responsive typography, context and following controls.
Oversized timed segments wrap while retaining their original timing and animation
owners. See [VALIDATION.md](VALIDATION.md) for checks and installation status.
Reported source/ruby paint clipping remains **unfixed and deferred to Pass 7**.

## What works now

- Word/syllable, line-synced, and plain-text lyrics, depending on available data.
- Musixmatch, AMLL community TTML, LRCLIB, and Spotify integration.
- Provider selection with word-sync labels; a failed source doesn't erase a
  successful result from another source.
- Overlapping lead/backing vocals, with scrolling based on measured line bounds.
- Lyrics page and fullscreen/cinema views, animated cover-art backgrounds.
- Settings for sources, fetching on track change versus when needed, and sidebar
  enable/disable under **Now Playing → Enabled**. See [LOCAL.md](LOCAL.md).
- Shared skip debounce: first change starts immediately; rapid skips settle for
  800 ms before another lookup. Provider-specific cooldowns still apply.
- Demand-driven alternate text with separate Now Playing and Full Lyrics choices:
  Japanese Romaji/Kana/Furigana, Chinese pinyin and Korean romaja. Original text
  appears immediately; conversion/alignment failures keep it readable. Dictionaries
  are bundled locally, and every real backing voice is eligible.
- Optional above readings and attached Japanese furigana for each real voice, with per-view
  size, spacing, opacity and alignment. Reading effects inherit the current text
  case or use independent Word/Line overrides. Off stops their work.
- Four independent text-rendering cases: **Lyrics → Now Playing / Fullscreen →
  Word sync / Line sync**. Word sources start expressive; Line sources start muted.
  Actual source precision selects the case, even when Word text is displayed as Line.
  Untimed lyrics stay plain without an extra configurable branch.
- Editable text presets and independent effects; universal gap-dot threshold/motion
  settings belong to each view and are never changed by a text preset.
- Shared lyric delay and independent per-view offsets; positive means lyrics later.
- One lyric font family, with an empty value following Spotify/theme fonts.
  Independent Now Playing/Fullscreen primary-size multipliers retain responsive
  sizing and show current CSS pixels; backing ratio, weights, source leading,
  group spacing and inset are adjustable. Word/Line effects remain independent.
- Source-group context before/after the entire active block; manual browsing and
  Auto-follow Off reveal the whole song. Context-filtered visual work stops.
- Classic/instant/native-smooth following, a preferred 45% readable-viewport
  anchor, and Classic/after-delay resume. Off leaves external seeks stationary;
  explicit lyric clicks still seek and recenter once.
- Grapheme-safe emphasis and cross-span cluster handling, with conservative shaping
  units for joining scripts and original timing provenance retained.
- Local-file lyric lookup through metadata-capable sources.

No dependency on the original author's update server, hosted dictionaries, fonts,
analytics or lyric backend. This doesn't mean every song works offline: providers
and artwork still need network access unless their results are already cached.
No promise of unlimited requests or word timing for every track.

## Planned, not implemented

- Detailed effect amounts/curves and background controls.
- Translation and further presentation controls.
- Exact 30-day positive caches, clear-all and clear-current-track controls.
- Better alternate-name/edition matching and sidebar compatibility.
- Further background/effect profiling before larger optimization work.

## Build

Install Node.js 20+ and npm, then from this repository:

```sh
npm ci
npm test
npm run build
```

Output: `dist/just-enough-lyrics.mjs`. It includes styles and language data;
there are no extra browser assets to host. The dictionary payloads are checked
against the originals during the build. Edit TypeScript/SCSS sources, not `dist`.
The release copy is `Extension/Builds/Release/just-enough-lyrics.mjs`. The old
`dist/beautiful-lyrics-local.mjs` and `Extension/Builds/Release/beautiful-lyrics.mjs`
paths remain compatibility aliases. All four contain identical complete builds;
a shared startup guard prevents duplicate initialization across these aliases.
The root npm commands are the supported build path, not the inherited release tools.

## Install / update

Have a working Spicetify installation first. Disable unrelated/upstream Beautiful
Lyrics installations so both products don't run together. The Windows installer
automatically migrates this fork's recognized old local registration.

On Windows, from the repo:

```powershell
./scripts/install.ps1
```

This backs up the existing config/bundles, preserves unrelated extensions and
theme, then applies once for filename migration or refreshes extensions on updates.
It restores the prior files/config if installation fails and attempts to reapply
the previous setup if Spotify was already changed. Reload Spotify afterward.
If PowerShell blocks scripts, use the manual installation below rather than
changing your machine-wide execution policy.

On any platform:

1. Run `spicetify path -e root` to find the Extensions directory.
2. Copy `dist/just-enough-lyrics.mjs` into that directory.
3. Remove this fork's old registration if you used that filename, then enable it:

```sh
spicetify config extensions beautiful-lyrics-local.mjs-
spicetify config extensions just-enough-lyrics.mjs
spicetify apply
```

If this fork's old release was registered as `beautiful-lyrics.mjs`, remove that
registration with `spicetify config extensions beautiful-lyrics.mjs-` instead of
the old local filename above. Check which file you installed; do not leave an old
pre-migration build enabled alongside JEL. The shared guard protects the newly
built aliases, not arbitrary older/upstream code.

For subsequent bundle replacements, use `spicetify -e refresh` and reload Spotify.
If you're installing only the built file, Node/npm are not needed to run the
extension itself. Keep your existing theme; no Comfy-specific dependency is required.

Open Just Enough Lyrics Settings from its topbar icon. For less background fetching,
choose **When required** and disable **Now Playing sidebar lyrics**. An enabled
sidebar requests lyrics on track changes even when the full page is closed.
Under **Lyrics**, each viewer has collapsible **Word sync** and **Line sync**
settings. A Word source displayed as Line still uses its Word-source settings.
**Text preset** copies editable text effects; changing an effect makes it Custom.
Line sources use whole-line rendering and expose only supported effects. Turning
Now Playing off collapses all its options while retaining their values. Fullscreen
also covers the lyric page and cinema view.

**Gap dots after (s)** and **Dot motion** are shared by both source cases in that
viewer. Zero disables dots; positive values mean minimum real silence across all
voices (100 means 100 seconds). Very short eligible gaps use static dots. Minimal
is a text preset; it does not turn off independently enabled dots or backgrounds.

Each view has one **Conversions** group: enable a language, choose its conversion,
then choose **Replace** or **Above**. Japanese supports **Romaji**, orthographic
**Kana**, and **Furigana** attached above kanji. Furigana preserves the original;
switching back remembers the previous placement. Chinese uses pinyin and Korean
uses romaja. Off shows Original and remembers the choices. Conversion starts only
for an active view requesting that language; shared work is released per view.
Settings apply immediately. Incomplete/invalid numbers keep the last valid value;
credentials apply when editing finishes or Enter is pressed. Question-mark help
explains controls, with Classic values at each tooltip's bottom. The existing text button in a lyric view
changes only that view's language preference.
**Behavior → Lyric delay (s)** applies to both views; **Delay offset (s)** adds a
view-specific adjustment. Positive means later, negative means earlier.

Old internal routes, saved credentials/cache keys and local helper commands remain
compatible. `JustEnoughLyrics` is the runtime diagnostic handle;
`BeautifulLyricsLocal` remains an alias to the same instance. The repository URL
and upstream credits have not changed.

## Limitations and troubleshooting

Provider catalogs differ. Spotify currently supplies line/plain data in our tested
responses; it is not a replacement for rich word timing. Spotify client endpoints
can change. A 404 can simply mean a source has nothing for that recording.

Caches currently have inherited expiry rules, not the planned exact 30-day policy.
Cold Japanese conversion loads the local dictionary; uncertain source alignment
falls back to Original. Furigana attaches only to safely aligned kanji ranges, leaving okurigana on the
original baseline. Ambiguous readings are omitted. Above keeps the original
voice below its reading. Failed conversions add no duplicate source row. Readings retain
grouped source intervals and real gaps, not newly measured phoneme timing. Synthetic/native UI checks do not certify every song,
script, font or client platform. See [LOCAL.md](LOCAL.md) for details and
[VALIDATION.md](VALIDATION.md) for what was actually checked.

For a bug report, include the Spotify track URI, selected source, Spotify/Spicetify
versions, and reproduction steps. Don't post tokens or raw credential-bearing URLs.

## Credits

Original extension by [surfbryce / SoCalifornian](https://github.com/surfbryce).
Local fork maintained by [BlankIsDumb](https://github.com/BlankIsDumb).
Thanks to the lyric catalogs, community timing contributors, and bundled libraries.
No project-wide license was found in the upstream repository or this checkout.
This fork does not grant a license to the original author's code. Third-party
dependencies retain their own licenses.
