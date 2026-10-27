# Just Enough Lyrics

A personal fork of [Beautiful Lyrics](https://github.com/surfbryce/beautiful-lyrics).
The aim: keep the animated lyrics, make the extension build locally, and gradually
turn the things you don't want into switches. Some of those switches exist. The
rest are still on the increasingly unreasonable to-do list.

This is an independent fork, not an upstream release. Please report fork problems
here rather than sending the original author bugs from this build.

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
  Japanese primary Romaji/Kana, Chinese pinyin and Korean romaja. Original text
  appears immediately; conversion/alignment failures keep it readable. Dictionaries
  are bundled locally, and every real backing voice is eligible.
- Shared lyric delay and independent per-view offsets; positive means lyrics later.
- Grapheme-safe emphasis and cross-span cluster handling, with conservative shaping
  units for joining scripts and original timing provenance retained.
- Local-file lyric lookup through metadata-capable sources.

No dependency on the original author's update server, hosted dictionaries, fonts,
analytics or lyric backend. This doesn't mean every song works offline: providers
and artwork still need network access unless their results are already cached.
No promise of unlimited requests or word timing for every track.

## Planned, not implemented

- More individual visual/animation controls and font-size settings.
- Furigana/ruby, translation and secondary-line layouts.
- Exact 30-day positive caches, clear-all and clear-current-track controls.
- Better alternate-name/edition matching and sidebar compatibility.
- Performance measurements before taking a chainsaw to the animations.

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
Text preferences are independent under **Now Playing** and **Full Lyrics**.
Each view's **Alternate text** switch reveals its language choices and **Japanese
text → Romaji / Kana**. Off shows Original and remembers those choices. Processing
starts only for an active view requesting a supported language; matching work is
shared, and closing/turning it off releases that view's request.
Edits apply on **Save**. Question-mark help explains the controls, with Classic
defaults at the bottom of each tooltip. The existing text button in a lyric view
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
falls back to Original. Synthetic/native UI checks do not certify every song,
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
