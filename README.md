# Beautiful Lyrics, with probably too much customization

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
  enable/disable. Sidebar compatibility still needs work; see [LOCAL.md](LOCAL.md).
- Shared skip debounce: first change starts immediately; rapid skips settle for
  800 ms before another lookup. Provider-specific cooldowns still apply.
- Existing Japanese/Korean/Chinese romanization, with dictionaries bundled locally.
- Local-file lyric lookup through metadata-capable sources.

No dependency on the original author's update server, hosted dictionaries, fonts,
analytics or lyric backend. This doesn't mean every song works offline: providers
and artwork still need network access unless their results are already cached.
No promise of unlimited requests or word timing for every track.

## Planned, not implemented

- More individual visual/animation controls and font-size settings.
- Furigana, kana/romaji/translation modes, inline and secondary-line layouts.
- Optional language processing that never blocks the original lyrics.
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

Output: `dist/beautiful-lyrics-local.mjs`. It includes styles and language data;
there are no extra browser assets to host. The dictionary payloads are checked
against the originals during the build. Edit TypeScript/SCSS sources, not `dist`.
The same build also writes `Extension/Builds/Release/beautiful-lyrics.mjs` for the
existing release path. Both files contain the identical self-contained extension;
the release file no longer downloads a bundle from the original author's server.
The root npm commands are the supported build path, not the inherited release tools.

## Install / update

Have a working Spicetify installation first. Disable the old Beautiful Lyrics
extension so both versions don't run together.

On Windows, from the repo:

```powershell
./scripts/install.ps1
```

This backs up the existing config/bundle, preserves enabled extensions and theme,
then applies an extension refresh (or initial apply). Reload Spotify afterward.
If PowerShell blocks scripts, use the manual installation below rather than
changing your machine-wide execution policy.

On any platform:

1. Run `spicetify path -e root` to find the Extensions directory.
2. Copy `dist/beautiful-lyrics-local.mjs` into that directory.
3. Enable and apply it:

```sh
spicetify config extensions beautiful-lyrics-local.mjs
spicetify apply
```

For subsequent bundle replacements, use `spicetify -e refresh` and reload Spotify.
If you're installing only the built file, Node/npm are not needed to run the
extension itself. Keep your existing theme; no Comfy-specific dependency is required.

Open Beautiful Lyrics Settings from its topbar icon. For less background fetching,
choose **When required** and disable **Now Playing sidebar lyrics**. An enabled
sidebar requests lyrics on track changes even when the full page is closed.

## Limitations and troubleshooting

Provider catalogs differ. Spotify currently supplies line/plain data in our tested
responses; it is not a replacement for rich word timing. Spotify client endpoints
can change. A 404 can simply mean a source has nothing for that recording.

Caches currently have inherited expiry rules, not the planned exact 30-day policy.
Romanization still runs eagerly on fresh supported-language data. Neither behavior
is being advertised as finished. See [LOCAL.md](LOCAL.md) for details and
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
