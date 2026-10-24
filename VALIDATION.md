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

Prior local.2 bundle and both installed copies: SHA256 3FB82470672442CD31EDFD84CE33A818D4A653C12B0A73B7950BE93EF04C6949.

## Four-provider build: 5.1.0-local.3 (2026-10-23)

- 36 tests pass: provider failure isolation, malformed timing, word/line ranking,
  LRCLIB LRC and Lyricsfile YAML, local metadata queries, optional-token behavior,
  Retry-After cooldown, cache reuse, and existing timing/debounce regressions.
- Built with Node 24; npm test passes explicit file paths for Windows/Node 20/24.
- Live local file プリマステラ / 鹿乃 / nowhere: LRCLIB line lyrics loaded, 33
  nonblank timing groups. Lyrics Plus's previously inspected LRCLIB result had
  36 entries including separators. The lookup uses metadata, not a Spotify ID.
- Live streamed track 2ZVyBbwFzdEHZZP1zCtyqa: LRCLIB returned HTTP 503; Musixmatch
  still rendered 44 timing groups with the failure confined to source warnings.
- Live fullscreen picker on a subsequent track exposed Musixmatch and LRCLIB;
  switching to LRCLIB and back changed the selected provider with zero new resource
  requests. No captured error or unhandled-rejection events during these checks.
- Final fullscreen check on 4ReCD8wyqRUxjqg6qOhC8u showed Musixmatch (word sync),
  129 distinct timings, with the menu correctly anchored over the cover controls.
  The open menu keeps its anchor visible during the existing inactivity fade.
- Settings button appeared adjacent to Comfy; modal contained an empty password
  field. No Spicy request was issued without a configured token. Authenticated
  Spicy transport/caching was tested with mocked HTTP responses, not a live key.
  Publishable-key origin configuration still needs validation with the user's key.
- Comfy installed user.css and extensions/theme.js SHA256 values remain identical
  to the pre-install baseline. No Comfy source or settings edits were made.
- Cache settings UI, translated-name searching, Spotify as a direct provider,
  progressive display before all providers finish, and performance redesign remain
  outside this pass. A failing provider can delay settlement up to its timeout.

Final local.3 bundle, Spicetify Extensions copy, and applied Spotify copy:
SHA256 `6B99EF889FF94F3FA796F2777A26C99A961BB4E07D546EE957E7F9EFF0A9C78C`.

## Behavior settings and local Spicy transport: local.4 (2026-10-24)

- 41 tests pass with loopback networking allowed. The sandbox-only run passed
  39 tests but could not connect to the two relay test servers; rerunning with
  loopback access passed all 41. Build and source diff whitespace checks pass.
- The user's client key allows no-Origin requests. Browser -> 127.0.0.1:8967 ->
  official Spicy API succeeds. Relay forwards neither Origin nor Spotify tokens.
  See LOCAL.md for manual startup after reboot. No startup task installed.
- Live 5j7ixaLeGTGSv4DzKs0pCM selected Spicy: 298 unique timings and 298 rendered
  syllable elements, with Apple Music attribution. Screenshot checked. Musixmatch
  and LRCLIB remained alternatives. No captured uncaught errors or unhandled
  rejections during settings/navigation checks.
- An earlier missing Spicy candidate was not reproducible after settled lookup.
  Local preparation failures now appear in source warnings; no cause established
  for the earlier observation.
- Live When required + sidebar off outside our page made zero provider requests;
  opening the page fetched/rendered lyrics. Closing/reopening the same completed
  song made zero requests. Disabling all providers made zero requests and returned
  no cached choices. Restored preferences, page, paused track and position;
  removed temporary runtime QA listeners.
- Topbar injected buttons/descendants explicitly use no-drag to exclude native
  title-bar dragging. Both load orders observed with this style; CDP clicks work.
  Physical OS mouse clicking still needs user confirmation.
- Sidebar toggle owns observer/card cleanup. Existing Now Playing DOM
  compatibility problem remains outside this pass.
- 3Qk92ozKLvbNyFMwkjNPfO: installed Lyrics Plus selected LRCLIB (57 entries);
  our parser accepted 56 nonblank lines. Spotify returned UNSYNCED MusixMatch
  (56 lines). Exact-duration NetEase match 3362570936 returned 59 LRC lines and
  no YRC. Exact historical LRCLIB failure unknown; outage/cooldown is possible.
  Spicy returned Apple Music syllable data: 59 lines and 261 lead segments.
- Spotify/NetEase remain investigation only. Premium does not establish unlimited
  lyric quota. NetEase needs metadata matching and a YRC parser for word timing;
  this probe does not establish general catalog coverage.
- Comfy applied user.css/theme.js hashes and comfy:config unchanged; checkout clean.
  No commit or push made. Progressive display and animation redesign deferred.

Final local.4 bundle and applied Spotify copy SHA256:
`E39D56C59A84598B371A150BC3F02397C9F1D2880CC7D6BB023E5BAA0D29B3B0`.

## Startup relay warning / macOS launcher (2026-10-24)
- Added one bounded credential-free health request at startup when a Spicy token
  exists. Timeout/disposal cleanup; no polling and no upstream API call.
- Live Spotify with relay stopped: warning toast visible and exactly one startup
  health request. Restarted updated relay; browser health endpoint verified.
- macOS .command launcher added (Node 20+, Homebrew paths, nohup, duplicate-start
  health check). Bash syntax passes; actual macOS launch/Login Items not tested
  from this Windows host. No scheduler/login settings modified.
- Build and all 41 tests pass, including health CORS and foreign-origin rejection.

## Dictionary corruption fix and audit — 2026-10-24
See AUDIT-2026-10-24.md. Old bundle had three invalid embedded Base64 payloads;
rebuilt all 12 and added exact dictionary integrity checks before/after write.
GHOST now loads Spicy 41-timing Line lyrics with LRCLIB 45-timing alternative.
Musixmatch 401/cooldown does not suppress these results. Settled DOM has 45 vocal
 groups including interludes and no loading placeholder. 42 tests and build pass.
New bundle/applied SHA256: 3B25F26ED783DDDC205D9A7636152D193B3BCF843D44837CE4B083A80FB7B7C3.
Origin of prior artifact corruption remains unknown. Audit findings left separate.
