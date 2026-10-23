# Beautiful Lyrics Local

This fork runs its code, styles, Chinese dictionaries, and Japanese dictionary
locally. It uses Spotify's installed font stack and a bundled placeholder image.
It does not contact any `socalifornian.live` service. The old Deno hosted-release
tools remain in the checkout for history, but are not used by this build or manifest.

## Build and install

From this directory, with Node.js 20+ and Spicetify installed:

```powershell
npm ci
npm test
npm run build
./scripts/install.ps1
```

Reload Spotify afterward. The output is `dist/beautiful-lyrics-local.mjs`.
It is approximately 27 MiB because it includes compressed Japanese dictionaries
instead of downloading them at runtime. Dictionary decompression waits until
Japanese lyrics need romanization. No development server is required.

The installer backs up configuration and any previous local bundle under
`local-backups/`, appends this extension, checks that existing extensions and the
theme/scheme remain selected, and applies Spicetify without restarting Spotify.
The first installation needs `apply` to register the script; later builds use
extension-only refresh. It does not edit any theme source files.

To disable, run `spicetify config extensions beautiful-lyrics-local.mjs-`, then
`spicetify apply -n` and reload Spotify. Do not install the old
`Extension/Builds/Release/beautiful-lyrics.mjs` remote updater alongside this build.

## Lyrics and provider limitations

The original client fetched lyrics, not just updates, from the author's server.
That server's implementation is absent from this repository. This build requests
Musixmatch directly through Spotify's Cosmos transport, using Musixmatch's own
token. Spotify credentials are never sent to Musixmatch. The transport follows
the direct richsync flow also present in
[Spicetify Lyrics Plus](https://github.com/spicetify/cli/blob/main/CustomApps/lyrics-plus/ProviderMusixmatch.js).

AMLL is also queried directly from its GitHub TTML database using the playing
Spotify ID and, when different, Spotify metadata's canonical ID. This is an ID
lookup, not a title search; romanized/translated names do not affect it. Both
sources are compared by the number of distinct nonblank vocal start timestamps,
rounded to milliseconds. Duplicated simultaneous timestamps count once; ties
prefer AMLL. This is a simple granularity heuristic, not proof of audible accuracy.
AMLL timestamps are bounded against track duration and retain background vocals,
singer alignment and overlaps. Lyrics Plus, LRCLIB and Spotify lyric providers
are not part of this extension's provider chain.

Each provider has an independent cache. Musixmatch and transformed lyrics use
the inherited calendar-month expiry; this is NOT a rolling 30 days. It rounds to
midnight, advances the month, then selects day zero (the preceding month end).
For example, October 23 entries expire October 31 at midnight. AMLL and Spotify
metadata use two weeks, rounded to midnight (AMLL includes missing ID files).
Expired/version-mismatched records are ignored on lookup, not actively deleted.
There is no scheduled purge, storage size cap or manual cache-clear UI. Service/parser failures are not
negative-cached. A valid provider can still be selected while another fails;
`BeautifulLyricsLocal.status().source` reports candidates, score and warnings.
Transformed lyrics are keyed by source/content fingerprint, so switching source
cannot reuse another provider's timing. Old Musixmatch conversion caches are
invalidated by version rather than deleting unrelated app caches.

Real richsync offsets feed the existing syllable renderer. The renderer's original
character stagger remains a visual interpolation, not extra provider timestamps.
Some Musixmatch segments contain entire phrases. Blank separator inversions no
longer reject otherwise usable richsync; zero-duration visible segments are
instantaneous events, without invented sustain. Overlapping lines retain their
own timing. Auto-scroll keeps active vocals together if their measured bounds fit;
otherwise it prioritizes the newest active vocal. A scoped ResizeObserver tracks
line wrapping/font-size changes, with batched layout updates and lifecycle cleanup.
No new per-frame layout scan or permanent polling is used.

Live requests succeeded without a paid Musixmatch account/API key during testing.
That is **not a guarantee of unlimited access**: this is a client endpoint, not a
contracted API. Premium Spotify status does not change Musixmatch access rights.
No verified numeric quota is assumed. The integration:

- retains its provider token across reloads;
- caches provider/transformed lyrics separately from upstream caches;
- coalesces duplicate lookups and serializes requests at least two seconds apart;
- drops queued requests for skipped songs, including changes during quota spacing;
- uses one shared song-change gate before all lyric providers: isolated changes
  dispatch immediately, another change within 800 ms waits 800 ms, and subsequent
  changes reset that wait. Superseded waiters are released, with one timer at most.
  Metadata loading runs independently; provider-specific limits still apply.
- pauses requests for 15 minutes on 401/402/403/429 and one minute on transport failure;
- exposes access errors instead of disguising them as missing lyrics or persisting them as negative results.

New lyrics and artwork still require provider/Spotify network access. "Local"
means independence from the original author's infrastructure, not a complete
offline music/lyrics catalogue.

## Compatibility and scope

- Replaced the remote loader with a repeatable Node/esbuild/Sass build. Styles
  finish compiling before the single output file is written.
- Removed hosted fonts, analytics, changelog media, and Discord verification from
  the runtime entry point; bundled both language dictionaries.
- Removed the global RequestBuilder monkey patch; metadata uses an owned JSON
  request and handles unavailable responses.
- Fixed missing history state on cinema/native fullscreen navigation and removed
  animation-frame dependence from service readiness in hidden windows.
- Removed styling/background injection across the whole Now Playing sidebar;
  Comfy continues to own its artwork, cards, and controls. Generic loading/control
  selectors are scoped to the extension.
- Fixed background cleanup-list growth per animation frame and disposal of old
  GPU textures/materials. Broader performance tuning and feature toggles are deferred.

The renderer still animates lyrics/backgrounds and still uses upstream playback
position polling. It has not received a full performance redesign or a long-term
memory/GPU benchmark. Playlist/like mutation workflows are not part of the live
verification because testing them would change the library.

## Verification

See `VALIDATION.md` for the tested versions, results, and remaining warnings.
`BeautifulLyricsLocal.status()` in Spotify's console exposes current track,
loaded state, sync type, and a sanitized provider error; it never exposes tokens.

AMLL still queries track files directly. Normal 404s are cached as missing without
an application warning; Chromium may log the HTTP 404 itself. No catalog index
or global console suppression is used. Visibility-gated fetching remains deferred.
