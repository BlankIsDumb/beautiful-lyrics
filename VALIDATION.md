# Local verification — 2026-10-22

## Environment

- Windows, Spotify **1.2.99.317**, Spicetify **2.46.2** (read from running client).
- Active theme **Comfy / tuyu**; existing `albumregion.js`, `metadata.js`,
  `opentrackin.js`, `lyrics-plus`, and `marketplace` preserved.
- Installed `beautiful-lyrics-local.mjs`, loaded by Spotify's normal module script
  registration after reload. No local development server.

## Passed

- `npm test`: **12 tests**, covering real-offset conversion, whitespace/word
  grouping, Japanese segment preservation, invalid timing, empty lyrics, line
  fallback, duplicate requests, stale songs, wrong recordings, ISRC re-releases,
  quota/access denial, and static fallback. Provider failure tests use a fake
  transport and consume no remote quota.
- `npm run build`, `node --check dist/beautiful-lyrics-local.mjs`, and
  `git -c core.whitespace=cr-at-eol diff --check`.
- The build rejects any remaining `socalifornian.live` reference in its output.
  No author-domain requests were observed in the live checks.
- Direct Musixmatch token and richsync requests succeeded. For Lilas's
  **スパークル**, the provider returned 29 lyric lines; Beautiful Lyrics rendered
  **54 timed segments** using its existing syllable renderer.
- Visually checked the lyric page and fullscreen layout. Exercised cinema,
  native fullscreen entry/exit, Japanese romanization, pause, seek to **45 s**,
  and return navigation on the final build. No extension errors or unhandled
  rejections were captured in those exercises. Original playback was restored.
- Line-synced and static results were also observed on other playing tracks.
  Provider mismatch errors display a message instead of leaving an endless loader.
- Comfy configuration and Spotify's shared RequestBuilder function remained
  unchanged during the tests. The sidebar did not acquire the extension's
  full-sidebar background class.
- Comfy's installed `user.css` and `extensions/theme.js` SHA-256 hashes match
  their pre-install hashes. The Comfy Git checkout remains clean.
- Spicetify regenerated `colors.css` during initial registration, so its byte hash
  changed. Its named color values were checked against the selected Tuyu palette;
  this file is not claimed to be byte-identical to the pre-install version.
- The built bundle, Spicetify's extension source copy, and Spotify's installed
  extension all have SHA-256:
  `D0AA1F49A3934CB8D4CB9329B2E565BB51196E6BBFBA70D75692284C1442B37D`.

## Limits and unrelated warnings

Spotify's console is **not globally error-free**. Startup still reports Comfy's
existing call to `sp://messages/v1/container/control` as `Resolver not found`,
alongside a Spotify transport error. The call is present in the unchanged Comfy
source (`Comfy/theme.js`, around line 1893). It was not altered in this task.

The two history-state exceptions seen in intermediate Beautiful Lyrics builds
were repaired and were absent in the final cinema/fullscreen exercises.

Successful direct richsync access does not establish an unlimited quota, future
availability, or Apple Music parity. No stress test was performed to deliberately
exhaust provider limits. Access/quota handling was verified with controlled tests.
Japanese timing can be phrase-level even when the provider labels it richsync.

This is a functional compatibility check, not an exhaustive certification across
all songs, languages, remote-playback devices, or future Spotify releases.
Chinese/Korean romanization and playlist/library mutation workflows were not
live-tested. No sustained GPU/CPU or long-duration leak benchmark was performed.
The original animated renderer and playback polling remain; feature toggles and
broader performance changes are intentionally deferred.

See [LOCAL.md](LOCAL.md) for build, update, and disable instructions. No commit or
push was made.


## AMLL and overlap update — 2026-10-23

- Added direct AMLL Spotify-ID TTML lookup, including Spotify canonical ID.
  Provider caches remain separate; selection compares distinct millisecond-rounded
  vocal start times, with AMLL winning ties. Source/candidate diagnostics are in
  `BeautifulLyricsLocal.status().source`.
- Live 夏霞 (`34jv2mOVzPjncrBncjYl6F`): AMLL selected with 309 unique
  timestamps versus Musixmatch's 38; original first-line internal pause retained.
- Live BMTH (`2tWhiQJQSTa5WE3eiByOf1`): Musixmatch now loads, 421 unique
  timestamps / 423 rendered segments. Blank 1 ms inversions no longer reject the
  song. No NaN/Infinity styles at the tested position. This does not establish
  that every upstream timestamp is audibly correct or identifies backing vocals.
- ZUTOMAYO examples: both have ISRC JPPO02200055 and duration 275.413 seconds.
  English ID `47fgnLoZgfkovAJgnLlgFp` canonicalizes to Japanese ID
  `0MIjWSye2T6s1y3HYP8j0Y`. Both AMLL ID paths returned 404 in this test.
  No name-based matching or translated-title guessing was added.
- Browser fixture in Spotify: 3 simultaneous vocals remained visible in a 350 px
  viewport at normal font size. At 160 px font, the older vocal moved out and the
  newer lead/backing remained visible (subpixel tolerance 1 px); at 25 px all fit
  again. Fixture and listeners were removed after the test.
- Initial live test exposed ResizeObserver delivery-loop warnings. The final
  code defers height writes to a coalesced animation-frame callback; the final
  overlap/font-resize fixture reported zero errors. No per-frame layout polling.
- 22 Node tests pass, including parser, backing/duet overlap, zero-duration events,
  provider selection/cache recovery, and viewport policy. Build passes;
  `git -c core.whitespace=cr-at-eol diff --check` passes (checkout has CRLF files).
- Final source bundle and both installed copies have SHA256
  `5160A84E5DBEA07E5605DE709D84C72FD013A003373230A927BA1F1BFB8A9DFE`.
  Installed Comfy user.css/theme.js hashes remain unchanged; Comfy checkout clean.
- Final installed local.2 status check on the then-current track reported loaded
  lyrics, no provider warnings, no nonfinite styles and no errors in the capture
  window. This is bounded runtime evidence, not a long-term performance benchmark.
- LRCLIB/Spotify providers, source dropdown and font-size UI remain deferred.


## Instantaneous lines and shared skip debounce — 2026-10-23

- Musixmatch whole-line intervals with equal endpoints are accepted, matching
  existing instantaneous-segment rendering. Backwards intervals remain invalid.
- Live `32oBu5wThPGrcDPbSxOFy3`: syllable lyrics loaded, 62 rendered segments,
  no provider warnings; checked at 25.154 seconds.
- Live `10Yk9WbT2840l1NK5RWvkq`: syllable lyrics loaded, 141 rendered segments,
  no provider warnings; checked at 141.050 seconds.
- Both tracks: no captured error/unhandled-rejection events or NaN/Infinity inline
  styles. Restored the previous paused track, position and page after verification.
- 25 tests cover parser boundaries, provider quota/caching, overlap handling, and
  the shared leading-edge debounce. Deterministic clock test checks immediate first
  change, reset on repeated skips, released superseded waits, and disposal cleanup.
  Provider test proves a song changed during the 2-second spacing is not dispatched.
- AMLL index experiment removed per user preference. All 80 retained AMLL network
  log entries examined were 404s; no separate 400 request was present in that capture.
  Local URIs cannot pass AMLL's Spotify-track-ID validation.
- Active WebGL renderer reported NVIDIA GeForce RTX 3070 Ti Laptop GPU through
  ANGLE/D3D11. Lyrics still use CPU JavaScript springs/CSS updates. No comparative
  CPU/GPU profiling or performance rewrite was performed.
- Comfy installed user.css and extensions/theme.js hashes match the prior baseline.
  Extension-only refresh preserves theme/scheme and enabled extension list.
- Cache expiration semantics documented, not changed. Manual cache clearing,
  visibility gating, LRCLIB/Spotify/Spicy providers and animation tuning deferred.

Final bundle and both installed copies: SHA256 3FB82470672442CD31EDFD84CE33A818D4A653C12B0A73B7950BE93EF04C6949.
