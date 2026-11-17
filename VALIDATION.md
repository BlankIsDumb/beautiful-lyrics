# Validation

## Song cache clear, distance fade and card glow — 5.1.0-local.42, 2026-11-17

All 699 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`59F686853AFC744DF0FFB1C4FB0985D4FFD9AB5ECBC6CE605558598888258C70`.

The corner provider menu ends with "Clear this song's cache". It removes the
playing track's entries from all five provider caches, resets provider
cooldowns and refetches the song. Other songs, track details and both tokens
are untouched, and a manually picked provider stays picked when it still has
lyrics. In Spotify on Windows, one click rewrote the song's five entries and
left every other entry at its earlier timestamp; the button stayed focused and
was unavailable until the lyrics had loaded again.

The Fullscreen profile has "Fade with distance" with "Fade length (lines)" and
"End opacity (%)" under Context. Each muted line gets one flat opacity by its
distance from the shown range; there is no mask, overlay or transition, and
values are written only when the shown range changes. The Now Playing card
never fades. In Spotify, with Opacity 70 and Fade length 4, the lines beside the
range carried 0.7, 0.525, 0.35 and 0.175, and further lines were hidden.

The Now Playing card no longer cuts the active line's glow at its left and
right edges. The five clip boxes around the lyrics now end at the card's edge,
16 px outside the text. In a headless browser the glow reached past the text on
both sides (0 lit pixels before, 174 left and 112 right after) with identical
text position, lyric width, scroll range and scrollbar position. In Spotify the
boxes span the card and a forced glow painted into the left gutter and stopped
at the card edge. The live glow during playback was not looked at natively,
because Spotify's window was covered and its animation was paused. The cost of
the fade and of the wider clip boxes is not measured. macOS and Linux are
untested.

## Pass 9 fixes and docs — 5.1.0-local.41, 2026-11-17

All 694 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`9BF41C71B1F966259CB64FC50433B907325139BBC98E2B41A4696B9CE234EF72`.

A read-only audit exercised every enabled control in the settings menu: all 109
saved, and none was dead. Without a theme, the settings menu, the card, the
corner menus and the fullscreen view rendered and worked. The stored tokens
appear in no tracked file or bundle.

Fixes: the settings menu opens without a focus outline; "Line height" shows a
rounded value without changing the stored one; settings migration backups older
than the two newest schemas are removed; the corner buttons and credit have a
faint edge so they read on a black page; one unused icon is removed. LOCAL.md
and README.md were corrected to match this build. In Spotify on Windows, the
focus on open, the Line height display and stored value, and the backup pruning
were checked. The corner edge was not looked at natively. macOS and Linux are
untested.

## Provider credit, card cleanup and card height — 5.1.0-local.40, 2026-11-17

All 689 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`14D360D2CC4647ABE37D8BFD8DB0967A52B2967E8A702E0B6764B6CE5A5CC087`.

Every view now shows a credit for the provider that answered. On the lyrics
page and in the fullscreen view it sits on the corner row, left of the two
buttons. In the Now Playing card it sits on the "Lyrics" row. Spicy credits
name the source, or the uploader and the maker with links for community syncs,
and say when the source is unknown. On the corner row the credit is bottom-aligned
with the buttons; the full suite ran before that one-line change, and the corner,
card and settings tests were rerun after it. The pinned credit box is removed. Spicy
contributors keep their role in the cache; older cache entries stay valid.

The Now Playing card no longer has hover buttons or a collapsed state. A new
"Card height" setting offers Default (340 px), Extended (500 px) and Max
(620 px). With Max and the default top anchor, one earlier line stays at the
top with the current line below it. Saved anchor and context settings are not
changed.

In Spotify on Windows, the three heights, the live switch, the Max follow
position on a paused active line, the credit in the card and on the lyrics
page, and the removed buttons were checked. Not checked natively: a community
credit with long names, real browser fullscreen, and Max during playback
across gaps and the end of a song.

## Fullscreen corner controls — 5.1.0-local.39, 2026-11-16

All 676 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`832C16848BF9EB220A3717770C31C5956273A0A0F74F16A77DB7FBF7CABA196C`.

The lyrics page and the fullscreen view now have two always-visible 40px
buttons in the bottom right corner of the lyrics area. The first opens a list
of the providers for the current song and switches on click. Its tooltip names
the current provider. The second opens quick settings: Fullscreen offset, text
size, conversions for the current song's language, auto-follow, background
mode, and a link to all settings. These write the same stored values as the
settings menu. The three-dot popup, the Romanize button and the lyrics page's
hover row are removed. The playbar buttons open and close the page. Menus use
the theme's card, text and border colors. In Spotify on Windows, button
placement, both menus, the steppers, the switches, Esc, outside click and the
playbar toggle were checked. Real browser fullscreen was not checked natively.

## Settings menu revamp — 5.1.0-local.38, 2026-11-16

All 671 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`E1DDF468C07E43BD968D87A02F18A556CAACCABDD7C27172E75F4C7B100FC886`.

The settings menu is reorganized into Behavior, Timings, Now Playing,
Fullscreen, Providers, Lyrics Font and Spicy. Each section is one continuous
block. Now Playing's options expand below its Enabled row in the same block.
Ordinary rows share one height whatever their control. The lyric delay, both
view offsets and the gap hold settings live under Timings. Gap dot settings
have their own group. Both gap hold numbers step by 0.1. Every help text was
rewritten to be short. Saved settings and their behavior are unchanged. In
Spotify on Windows, the section order, row heights, live saving, the status
line, tooltips and the 0.1 step were checked.

Nested group bands span the full block width. Depth shows through the darker
shade and a 16px label indent per level, while every control keeps a 16px
right inset. Button rows align to the right edge. The last section has 28px of
space below it. In Spotify, labels measured 32, 48 and 64px at depths 1 to 3,
and every control's right inset was 16px.

## Hold across gaps for word sync — 5.1.0-local.37, 2026-11-15

All 671 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`EBF2C9BEC8FF08FEA801FD0033853525412BD537BF7D099FE919F4512D37C629`.

Rich sync compensation now groups the gap limit with a new "Apply to word sync"
toggle, on by default. When it is on, rich sync that meets the minimum timed
segments per line also holds short gaps and keeps word timing. When it is off,
only line sync and rich sync below the minimum hold gaps. In Spotify on Windows,
switching the toggle released and restored the hold on a Musixmatch rich sync
track immediately, without reloading lyrics.

## Rich sync compensation — 5.1.0-local.36, 2026-11-15

All 440 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`D57E99D070E726D027C799482745DA0D1D295EB8612E91A8E08AC0A92C137B48`.

Gap holding now applies to Musixmatch, LRCLIB and Spotify. Line sync holds
short gaps. Rich sync that passes the minimum timed segments per line keeps its
literal timing. Rich sync below the minimum is shown as Line and holds short
gaps. AMLL and Spicy are unchanged, and so is source ranking. In Spotify on
Windows, Musixmatch and LRCLIB rich sync below the minimum were shown as Line
and held. Spicy word sync stayed literal.

## Spicy disk cache — 5.1.0-local.35, 2026-11-15

All 218 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`088CED64E02925B51F13B454FDD49CEBF3186ECC3C84C55383FB85633740A038`.

Spicy results are now cached on disk like the other providers. Lyrics are kept
for 14 days and not-found results for 1 day, measured from fetch time. This is
within Spicy's 30-day storage limit. With the local relay running in Spotify on
Windows, a track's first lookup was stored on disk with its credits, and
reloading it made no relay request. Clearing Spicy removed the entry. The
automatic reload then fetched it once more.

## Lyrics cache — 5.1.0-local.34, 2026-11-15

All 207 tests passed. The four production bundles passed syntax and dictionary
checks. They match the three Windows install copies at SHA-256
`F751A9BA946E151E00C3FEFF47E066D7F9072560C0DF744E622B70EF229D645E`.

Before the change, every existing cached entry was checked offline. None was
corrupt, and all live entries passed the new read validation, so upgrading
deletes nothing that is still valid. In Spotify on Windows, the first-session
cleanup removed expired entries and the retired prepared-lyrics store. Lyrics
cache storage went from 50 MB to 12.7 MB. The Settings cache counts matched
the stores. Clearing one provider removed only that provider's entries and
left saved credentials alone. With the Spicy relay stopped, lyrics from other
providers still loaded and Spicy was reported as unavailable.

## Independent background — 5.1.0-local.33, 2026-11-14

All 167 tests passed, including a real-WebGL Chromium fixture. That fixture
covers Static and paused sleep, context loss and restore, and 15 toggle and
remount cycles with no live contexts left. The four production bundles passed
syntax and dictionary checks. They match the three Windows install copies at
SHA-256 `E556726CBDD9326FB249CB9444570F179F4EDD6EC3062D7A64571093FC5F91FE`.

In Spotify on Windows, Off, Static and paused Freeze made zero background draws.
Frame caps held at 30 and 15 fps. Off removed the canvas, and the opt-in
Now Playing background left the theme's sidebar unchanged. On the Full Lyrics
page at a fixed size, the defaults lowered renderer→GPU traffic. Playing, it
fell from 25.5 MB/s to 4.95 MB/s against the original-cost Classic look. Paused,
it fell from 34.8 MB/s to 30 KB/s. GPU-process CPU fell from 61.6% to 10.3%
playing and from 45.5% to 3.2% paused. Classic look and settings remain
selectable.

## Read-only playback clock — 5.1.0-local.32, 2026-11-09

All 142 tests passed, including the paused handoff and Connect snapshot fixtures.
The four production bundles passed syntax and dictionary checks. They match
the three Windows install copies at SHA-256
`52EC787AE1E4FC85769C3A37DC68F0849CAD619A2DC5477F42D21E00DB60C6CD`.

The Windows client was traced with the MacBook as a real Connect output. Both
builds were tested through PC playback, seeks, pause/resume and handoffs in both
directions. The local.31 clock sent eight extra Resume commands. Local.32 sent
zero and still used the native position read on the PC. Its clock matched the
playing and paused remote seeks 10 ms and 12 ms after their Spotify state
updates, respectively, and stayed still through the paused interval.

A separate local.32 trace verified an actual MacBook track change and replayed
a same-track songchange while paused. The clock followed both with zero
playback writes. The original track, queue order, MacBook output, pause state
and position were restored. The trace used temporary DevTools instrumentation.

## Disabled cue fixture and local install — 5.1.0-local.31, 2026-11-06

The Chromium fixture now checks the cue's browser rectangle, current cached
top/bottom bounds and actual lyric flow. It still verifies that disabling the
cue leaves manual-scroll grace intact. The full serial suite passed 140 of 140.
The dictionary audit made no change to the build or integrity checks.

All four bundle aliases passed syntax and dictionary checks. Their SHA-256
matches all three installed copies.
`449E0FC1D79BCF2BB44D61C37CF67EB63C127970668B6B70A93A011F8AF2A622`

Spotify mounted local.31 with Cosmos, Platform, Player and a track with lyrics
loaded before and after a normal relaunch. The loopback DevTools listener on
127.0.0.1:8088 remained active after relaunch. The Spicetify configuration,
theme and unrelated extension hashes matched their pre-install values. The
local.28 rollback copies were backed up before installation. Playback and
visual acceptance for the card edges, Line profile and rich-sync changes
remain separate.

## Musixmatch rich sync compensation — 5.1.0-local.30, 2026-11-06

The baseline was committed as `4f8dcaa` before implementation. The current
candidate is built and tested in isolation. Native Spotify playback acceptance
is pending.

The audited timing data resolves Afterlife to Word with a short-gap hold and
脳裏上のクラッカー to Line. On this machine, the first selection took 5.0 ms and
1.1 ms respectively in Node with placeholder glyphs. A repeat selection from
the same prepared data averaged under 0.01 ms for both. Holds reuse existing
timeline events and the original source times.

Tests exercise equal-resolution Auto ties, manual selection, independent zero
values, exact cutoffs, overlapping backing vocals, effective Line profile,
visible hold, cue priority, and seeks. The full suite passed 139 of 140 checks.
The same disabled-cue height assertion that failed before this change remains
the sole failure. All four bundle aliases passed syntax
and dictionary checks and match SHA-256
`9513EF965568BCA1E1BF5570962D305940890C37B433674CF113CE29E7396C93`.

## Whole-line display profile — 5.1.0-local.29, 2026-11-06

The isolated Chromium renderer used conflicting Word and Line profiles on the
Now Playing card, ordinary lyrics page, and Fullscreen. Forced and genuine Line
used the same effects. Live edits reused the lyric DOM, the view profiles stayed
isolated, and switching mid-song kept the active voice and original seek target.
Separate checks covered inherited above-text effects, independent reading
overrides, ruby, and settings visibility and failed-save recovery.

Across the three-surface test and the serial rerun of the remaining suite,
135 of 136 checks passed. The disabled-cue height assertion also fails in an
isolated replay with the previous controller. The bundled Node 24 run crashed
in Sass during the ruby-layer fixture, which passed on system Node 20.

Built with the bundled Node 24 runtime. All four aliases pass syntax and bundled
dictionary checks and match SHA-256
`A126139DB77886848CC763F6BF7DD0C89A7B10D9C6734FB7C48AD499BB8294F9`.
This candidate was validated in isolated Chromium and has no native Spotify
playback result.

## Now Playing card edge fix — 5.1.0-local.28, 2026-11-06

Card following uses an 8 CSS px fade at each inner edge. The card measures the
last group’s actual bottom to set the lyric paint height, keeping fractional
row rounding from clipping the ending. The three follow-position tests and both
browser suites passed, including a 160-row case, short and oversized lyrics,
manual scrolling, and the three-surface anchor matrix.

All four built aliases passed syntax checks. The three installed copies match
SHA-256 `E397F2E0FA89FFD95719EE4CA58EE67965DE6442FF188EB534E56D828D41841D`.
The local.27 copies were backed up and Spotify was restarted. Native DevTools
was unavailable after restart. The edge checks use isolated Chromium.

## Pass 7 installed — 5.1.0-local.27, 2026-11-05

The serial suite passed 132 of 136 checks on its first run. Four ruby fixture
checks still expected integer measurement and the old clearance formula. All
four passed on focused reruns with fractional measurements and fitted clearance
assertions. Source code stayed fixed across those reruns. The independent
Classic cadence comparison passed against frozen local.26.

The final source replay of the captured DROP case kept canonical source owners.
The 112.787px and 34.967px baseline row steps became 64.412px each, with a
2.299px reading-to-previous-row clearance in the measured case. The controlled
paint replay recovered all 182 clipped pixels from the scaled source fixture.
The selected layout containment preserves the outer viewport paint boundary.
Steady render CPU p95 stayed in the baseline range in the paired isolated
GPU runs. The first font invalidation cost up to 13.6ms more in the 160-voice
ruby fixture, with the same number of batches.

The four build aliases and three installed copies share SHA-256
`CEA63D6475FB8620B8059915CF02FFBCE8573FC36A8024C27C47B3407D6760FD`.
All four pass syntax checks. All 12 bundled dictionary members match the
installed build dependencies byte for byte.

Spotify mounted local.27 with Cosmos, Platform and Player available after
Spicetify restore/reapply. DevTools verified the new easing, response and
cue controls for both viewers. The settings probe restored the original
route and preserved the saved presentation payload. No track was loaded
during that probe. Playback and paint validation above use isolated fixtures.

## Beta build — 5.1.0-local.26, 2026-11-03

The sidecard defaults to the readable top with zero preceding groups and all
following groups. Existing stored values take precedence. The extension status
and LRCLIB client ID read the release version from package.json.

The root build refreshed both canonical bundles and both compatibility aliases.
All four pass syntax checks and share SHA-256
`203EE60F08C9198C07B4F5CE123AA3697FF260AAA923C1D1AF22D8223DEA58D4`.
Native install evidence below covers the earlier local.25 build.

## Pass 6v3 installed — 5.1.0-local.25, 2026-11-02

Card natural song edges and per-view static muted context are implemented. Hide
remains default; blur/darkening/opacity are independent. User explicitly deferred
distance gradient after private GPU profiling; no new distance mask or gradient
settings ship. Existing viewport/card edge fades remain unchanged.
Schema10 preserves exact schema1–9 raw payload lazily before changed saves.

Final serial source suite: **133/133 tests pass**, zero failures/skips in138.86s.
The actual renderer matrix covers Word/true Line/forced Line with Original/Above/
ruby, stable geometry/node identity, independent reading opacity (including zero),
zero excluded Animate/continuous/settling calls, muted focus/opacity0 safety and
one-seek child/native-button/Enter behavior. Trusted wheel/ArrowDown retains manual
browsing while muted text has focus. Modal/reset/storage failure gates pass.

The Card fixture now includes the actual header/controls/padding. Its135 main
surface/source/context/anchor combinations preserve other-surface behavior;14
additional small/tall/fractional-scale cases verify physical readable first/last
edges and short-song top alignment. A focused Card-only height cap keeps the inner
scrollport within the existing outer clip when25cqh exceeds available card height.

These are controlled Chromium tests with synthetic timing, not native song proof.
Static muted text stops scheduler animation but can still incur paint/filter cost.
Independent default checks cover36 paired workloads, five geometry batches for
five resizes, no idle/ordinary-source-boundary extra geometry work and no disposed
clock/observer work. Paused explicit samples still count30 calls; animation work0.
Twelve exact nonwrapped PNGs and the Classic timing/spring-cadence gate pass.
Annotated resize timings vary; a focused three-triple CSS control did not establish
a repeatable inactive-selector regression, so no speculative rewrite was made.

Actual shipped GPU comparison: three fresh-browser triples of frozen local.24 Hide,
local.25 Hide and local.25 muted,160 Word/ruby sources and1/1 context. All runs keep
3 selected/157 excluded, with zero excluded visual calls, steady geometry batches
or disposed resources. Muted blur/darkening have real paint cost: main-render CPU
p95 per16.67ms bin is11.57–12.56ms versus5.82–6.94ms for local.25 Hide; these bins
are not native wall-frame latency/FPS. Own allocated tile data is2.88–3.01MB versus
.88–1.18MB. Enabled static blur is not advertised as free or as a speedup.

The unchanged production build/integrity guards and all four syntax checks pass.
Four generated aliases and three installed copies are28,476,481bytes, SHA256
`8BB20F09E4A3DE3C4FDE11D3099657A7EDF218EA05B9ADF4696049B0206F9904`.
Independent verification matches all12 embedded dictionary files byte-for-byte.
The first build attempt was rejected by its in-memory dictionary guard before
artifact writes; an unchanged retry passed. Its intermittent cause remains
unconfirmed; no guard or startup code was altered. Exact local.24 backups/config:
private pass6v3-20261102/install-backup-20261102-225824. Six unrelated installed
configuration/theme/extension hashes remain unchanged; all23 product-source hashes
matched the tested freeze at the time of the local.25 installation.

Native Spotify DevTools verifies mounted local.25, Cosmos ready and real lyrics.
Initial hidden-page geometry was not used as a passing test. Computer use was
limited to activating the existing Spotify window; measurements/settings checks
then used DevTools. On a real song, Card start is23.55px from the scrollport top;
at its ending the final block is124.28px from that top against125px readable-bottom
target, inside the actual outer clip, with the scroll at its natural maximum.
The new controls toggle blur/darkening independently. Ordinary page has6 selected/
54 muted source groups using its saved2/3 counts while Now Playing remains Hide.
This is native source/geometry/control proof, not universal song/monitor acceptance.
Exact original preference raw payload, playback state used for the seek check and
playlist route were restored; schema9 recovery backup verified. No own modal,
typography probes, focus emulation or private validation state remains. Native
fullscreen replay/monitor changes remain manual acceptance. RY-01/Pass7 paint
clipping remain deferred; the distance gradient is explicitly deferred too.

Evidence: npm-test-final.txt, parent-performance.json, parent-default-focused.json,
parent-paint-parity.json, parent-classic.txt, actual-context-results/analysis.json,
build-identities.json, native-card-ui-test.json, native-page-ui-test.json and
native-final.json in the private pass6v3-20261102 directory.
The installed local.24 evidence below remains historical and unchanged.

## Pass 6v2 installed — 5.1.0-local.24, 2026-11-02

Implementation adds unified fixed-anchor following, content-owned edge spacers,
three signed horizontal surfaces, lazy schema9 migration and cancellable live UI
previews. AL-01 outer-owner width scoping and AL-02 wrapped Word justification are
included. RY-01 ruby spacing and source/ruby paint clipping remain deferred.

Fresh styled baseline evidence is in the private pass6v2-20261102 directory:
baseline-follow.json and v2-follow.json. The repaired shared fixture includes real
Simplebar CSS and asserts bounded nonzero scrollports, real overflow and positive
source fonts. The reused12-scenario audit workload proves ordinary line placement;
its historical Word label has only one timed span per group and therefore is
actually line precision. Genuine multi-span Word, true Line and forced-Line tests
are separate and assert effective precision explicitly.

The expanded fixed-anchor browser fixture passes135 surface/source/context/anchor
combinations plus single-group/cue/silent-navigation/hidden/tall cases. The horizontal
fixture passes60 signed geometry/alignment cases plus collapsed/reopened surfaces,
nested ruby/Above/VoiceBlock and actual-primary four-em narrowing. These are controlled
Chromium components with synthetic timing, not authenticated native song replay.

Final source validation: **128/128 tests pass**, zero failures/skips, serial
`npm test` in128.32s. This includes the repaired styled renderer fixtures, real
trusted-wheel smooth interruption, explicit/paused/async clicks, delay edits,
manual/Off reflow anchors, migration/storage failures and modal cleanup.

Independent same-style paired performance covered36 workloads:40/80/160 groups ×
Word/Line × Original/Above/Furigana × frozenlocal.23/candidate. Each five-resize
sequence used five geometry batches in both versions, with zero idle, ordinary
activity or internal-word-boundary extra batches; paused animation/timeline work
and owned cleanup counts stayed zero (30 explicit paused sample calls remain). The native-like .9509072303771973 device scale quick
run also retained five batches and zero idle/cleanup work. At160groups, current /
baseline median batch milliseconds were Word Original19.2/19.7, Above42.1/42.5,
Furigana31.0/30.7; Line Original7.5/7.4, Above10.2/10.0, Furigana24.8/20.4. These
single-run timings have noise; the heavier Line/Furigana result remains a measured
cost limit, not evidence of universal speedup or guaranteed equal performance.

Independent12 nonwrapped exact PNG comparisons preserve stock-zero paint, and
the independent Classic animation/timing/spring-cadence gate passes1/1. This does not certify wrapped ruby paint
or fix the known RY-01/Pass7 clipping defects. Readout-only pixels use WeakMap
metadata; unchanged default columns retain original cqw rules. This followed a
measured causal control that isolated needless inherited-variable subtree restyles.

Evidence is in private pass6v2-20261102: npm-test-final.txt, parent-performance.json,
parent-performance-native-scale*.txt, parent-paint-parity.json/.txt and
parent-classic.txt. No native song-playback claim follows from these fixtures.

The fixed-anchor line matrix currently settles within0.50 CSS px across all three
surfaces and All/1-before/1-after, including first/last lines. The12 nonwrapped PNG
comparisons pass. Rollback requires
both the local.23 artifact and its pre-migration settings raw payload; preserve any
new schema9 choices first. Provider/session/Cosmos readiness logic is unchanged.

Production build, dictionary/dependency/persisted-file guards and all four syntax
checks pass. Four generated aliases and three installed copies match SHA256
`2FEBF54684B671CA041DDEAD20E8BBB5FDA0562E644DD3951A160D60450D73FD`.
Exact local.23 backups/config are in the private
pass6v2-20261102/install-backup-20261102-165945 directory. Six unrelated installed
configuration/theme/extension hashes remain unchanged. Final 21-file product-source
manifest still matches the tested freeze; `git diff --check` passes. No commit/push.

After restart, direct Spotify DevTools confirms mounted local.24, Cosmos/Platform/
Player ready and lyrics loaded. Real Contained playback samples place active
source blocks at561.46 and561.81 CSS px against561.30 preferred, at different
scroll positions. These observations do not certify every transition or surface.
Native Card geometry was unavailable/collapsed; Fullscreen playback replay and
monitor-change acceptance remain untested. Settings show live primary56/backing42
CSS px and Contained column metrics, with Fullscreen metrics explicitly labelled
as a preview. An independently opened settings dialog and saved preference edit
took priority: the native preview-input test skipped before sending input, and no
playback/preference commands were sent by validation. Preview cancellation and
cleanup are covered by automated fixtures. Exact pre-apply schema8 raw migration
backup is verified; latest schema9 user edits were preserved. Private validation
state was removed. No restore/reapply or readiness-code change was necessary.
Evidence: final-identities.json, post-restart-runtime.json, native-page-playback.json,
native-final-observation.json, native-delivery-final.json and the installation manifest.
Please test successive lines, manual resume, three surface limits/readouts, narrow/
wide windows and moving between monitors. AL-01/AL-02 fixes await acceptance on the
reported songs; RY-01 ruby gap/collision and Pass7 clipping remain unfixed.


## Pass 6 layout/context/following — 5.1.0-local.23, 2026-11-01

Post-test audit: user rejected the implemented stable-if-visible normal-follow
policy and clarified that every new line should reach a fixed anchor. That
correction is not implemented yet. Prior121 passing tests did not assert this
behavior; the shared scroller fixture also omitted Simplebar CSS. An audit-only
fixture with full production styles confirms the drift and first/last scroll-space
constraints. Outward inset is a separate pending clarification/correction. Results
below remain historical evidence for local.23, not proof of the corrected behavior.

- Implemented global lyric family (blank follows theme), per-view responsive
  primary/backing ratios and current CSS-pixel readouts, weights/leading/gap/inset,
  logical active-span context, stopped context-filtered visual work and configurable
  following/resume. Existing four Word/Line effect cases remain independent.
- Oversized source owners wrap with one timing/animation owner. A conditional
  sliced painter preserves one continuous gradient across rows; ordinary owners
  retain their original paint box. Wrapped reading rows reuse bounded layout
  exclusions, preserving unannotated first-row leading. Width/font changes and
  readings Off release stale wrapping/reservation state in the existing layout batch.
- **Full root `npm test`: 121/121 pass, zero failures/skips.** Includes corrected
  432-case ruby density, real typography/preview geometry, trusted manual wheel
  cancellation, asynchronous Spotify seek acknowledgement, paused clicks, delay
  edits after silence, browsing reflow, Unicode/gap/seek/reading ownership and
  cleanup. Test files run serially because concurrent owned Chromium processes
  caused resource/cleanup failures on this Windows machine.
- Two fixture assumptions were corrected rather than changing production policy:
  wrapping makes the former 18px overflow case renderable, so unavailable geometry
  now uses a genuinely zero-width surface; the manual-grace test selects its owned
  timer rather than another scroller's exactly-750ms timer. Deterministic sub-ms
  progression reproduces the old incorrect timer selection.
- Independent frozen-local.22 comparisons: **12/12 exact nonwrapped PNGs**, with
  equal text/geometry/animation state; **1/1 Classic cadence/geometry** gate.
  Wrapped paint also has an actual-pixel repeated-gradient negative control.
- Real mounted renderer/Simplebar synthetic-transport workload, 160 groups:
  default Word counters match local.22 (120 ticks, 119 continuous updates, 1071
  spring updates, 777 effect writes). Line counters match with no springs.
  Paused equal-time ticks do no timeline/effect/spring work. Disposal leaves zero
  clock consumers and observed targets. This is controlled component evidence,
  not native Spotify cadence or GPU/FPS proof.
- **12 serial paired resize workloads / 48 samples**, Word/forced-Line ×
  Original/Above/Furigana × fixed/responsive fonts, 40/80 voices: every sample
  produces five geometry batches and zero extra idle batches. At 80 voices,
  Word/Above maximum batches are 7.4/7.7ms fixed/responsive versus 8.6/8.0ms
  baseline; Original is 3.5/3.3ms versus 2.3/2.2ms. Heavy Line/Furigana still
  reaches 35.9ms fixed and 22.8ms responsive, versus 44.5/19.4ms baseline.
  These are single paired workload results with noise, not universal speedups.
  A real regression was isolated with a CSS-only control: a family `[style*=]`
  ancestor selector made height writes invalidate descendants. The final code
  toggles a presence class instead, preserving font behavior and avoiding that cost.
- Build through `npm run build`: **27.1 MiB / 10 stylesheets**, embedded dictionary
  and hosted-dependency guards pass. All four generated aliases pass `node --check`
  and have SHA256
  `AF7E2BCBF7C12729534CE88BFBD04C8A0FC044443C239D290EE359BF5427A1C0`.
- **Local delivery completed.** Roaming/Local Spicetify source copies and Spotify's
  installed extension match that hash. Exact old bundles/config are backed up in
  private evidence `pass6-20261101/install-backup-20261101-155603/`; six config/theme/
  unrelated-extension hashes remain unchanged after replacement and restart.
- **User confirms startup works after Spicetify restore/reapply.** No independent
  post-reapply native playback/appearance certification. During initial delivery,
  DevTools read-only checks showed the candidate CSS marker and runtime lease present,
  but `JustEnoughLyrics.version` is unavailable. `Spicetify.CosmosAsync` is missing;
  Player, Platform, History, Playbar, Snackbar and URI are present. The unchanged
  Session readiness path waits for CosmosAsync. Current client is Spotify
  1.2.99.317.g9bd8c54d, CLI 2.46.4; the wrapper logs waiting for required webpack
  modules. The reason the wrapper has not exposed CosmosAsync is not resolved in
  this pass. Stored presentation schema remains 7 (lazy migration, no preference
  edits). Temporary DevTools was closed. User subsequently resolved startup via
  restore/reapply; the precise cause is unconfirmed and diagnosis was stopped.
- **Pass 7 source/ruby paint clipping remains deferred.** Matched-font frozen.22
  and current native-font fixtures fail at exactly the same ruby bounds. The
  legacy geometry regression gate now explicitly retains its original effective
  sans-serif font and all bounds assertions. This does not certify inherited-font
  paint bounds. Musixmatch optional normalization reports remain a separate backlog.
- User test reminder once native startup works: test the four-em inset clamp at
  narrow/wide columns and across monitor changes, plus the preferred font/readouts,
  overlapping voices and manual follow controls. No commit or push was made.

## Ruby visual-row spacing — 5.1.0-local.22, 2026-10-31

- Replaces uniform wrapped Line/Static leading with one reusable empty layout
  exclusion inside the existing source paint owner. Only actual annotated visual
  rows receive additional clearance; first-row padding and existing blank-line
  space are handled separately. Original source text nodes, animation ownership,
  source timing and springs remain intact. The Word layout and paint-containment
  policy are unchanged.
- Independent density checks compare against untouched Original typography:
  **432 cases**, covering first-only/interior/sparse/dense readings, explicit and
  blank BR rows, fonts 18/29.6/42/56 px, actual wrap-threshold changes, both
  directions/opposite alignment, true Line, forced Line and Static sources.
  No candidate leading is copied into the density reference.
- Fractional neutral-owner width participates in the layout cache key. A real
  same-layer 343.4→343.7 px resize crosses a wrap while rounded `clientWidth`
  remains identical. Focused checks also cover warm primary position/velocity,
  spacer reuse, font/profile/source invalidation, unsafe/failure cleanup, Off and
  disposal. Prior conversion, opacity, actual primary-paint and batched-layout
  regressions pass in the focused runs. No per-frame geometry is introduced.
- **Glyph clipping is unfixed and deferred by explicit user instruction.** The
  user reports it across viewers. Clipping investigation stopped; this spacing
  patch does not claim a cause or relax paint containment. The build is applied;
  user manual testing is next.
- Final suite: **112/112**, zero failures/skips, including the 432-case density
  matrix. Independent accepted local.13 Original Classic gate: **1/1**; opacity:
  **108 scenarios / 396 roots**.
- Paired GPU Line/forced-Line/Static comparison: 80 voices / 320 readings,
  10 cases (five profiles × two versions). Playback geometry reads remain zero;
  local.22 active animation JS p95 is at most **0.2 ms**. Classic rendered
  frame-gap p95 is **16.6–19.2 ms** for local.22 versus **20.7–22.5 ms** for .21.
  Explicit full-song layout maxima increase to **47.3–100 ms** versus
  **31.7–48.7 ms**; both versions produce 13 batches and zero extra idle batches.
  Mount/toggle timings are noisy. This is a measured tradeoff, not free performance
  or proof of native Spotify FPS. Cleanup after GC returns to eight nodes / one
  listener for both versions.
- A broader current 32-configuration run plus a full-view case with real
  converters passes structural invariants, with zero playback geometry and zero
  settled work. Wall times were worse even for
  unchanged Above paths compared with an earlier run; machine/load variation
  prevents treating that unpaired difference as a causal performance result.
- Build: **27.1 MiB / 9 stylesheets**, dictionary guards pass and canonical
  `node --check` passes. All four aliases and all three installed copies match
  SHA256 `A271DEED4250811CEC174A437BDC0D9D134D7AC81EC94552DC6C1B2796EA67E4`.
  Config plus five checked Comfy/unrelated files remain unchanged. A staged,
  hash-verified apply and rollback backup are recorded in private evidence.
- Spotify restart was issued. The final native version-console attempt was
  interrupted before execution, so **no mounted local.22 API proof or native
  visual pass is claimed**. Source/build/apply are complete; manual validation and
  the deferred clipping report remain open. Based on beta `b21c976`;
  no push. The local.21 results below are historical.

## Shared conversion animation — 5.1.0-local.21, 2026-10-31

- Based on `b21c976` / local.20. Japanese Romaji/Kana fragments reconcile to
  canonical source animation owners; Chinese Pinyin and Korean Romaja retain
  their existing source units. Truly ambiguous merged tokens keep a complete
  grouped interval union, including real gaps/overlaps/points. No phoneme times
  are invented. Converter identity is `source-ranges-5-source-owners`.
- Reading arrival/removal no longer snaps primary springs. Compatible replacement
  owners retain numeric position/velocity; hidden canonical effects advance and
  settle through grouped fallback. Safe selected emphasis works for converted
  text and inherited/custom Word readings. Disabled/disposing effects release
  their mounted and cached resources. The opacity and written-kana fixes survive.
- Attached readings now occupy a neutral layer over intact primary DOM. Their
  width does not widen source spacing. Compact clearance, safe overhang/fit,
  cached natural metrics and whole-song measurement barriers replace fragmented
  source renderers. Width/font/emphasis changes invalidate the right metrics;
  playback does no geometry, alignment or conversion work.
- Final suite: **111/111**, zero failures/skips. Independent accepted local.13
  Original Classic gate: **1/1**. Independent opacity/highlight/hover matrix:
  **108 scenarios / 396 roots**. Tests include actual primary PNG equality,
  numeric spring continuity, async/toggles/seeks, source gaps/points/overlap,
  real Pinyin/Romaja and Japanese dictionary outputs, Word/forced-Line/true-Line/
  Static, lead/backing, narrow/aligned text, overhang/density/fit, font/cache
  invalidation, cleanup and no disabled-effect work.
- Broad serial performance comparison: **64 configurations**, 80 voices each,
  real local converters/controllers/scheduler/scroller, synthetic provider times.
  Separate-process cold converter checks avoid warmed-library comparisons.
  Minimal allocates no letters/springs and does no effect work. Steady paused/
  idle work stops; playback geometry/clone reads are zero. After churn and GC,
  DOM nodes and event listeners return to the empty-fixture baseline (7 and 1).
- Rendered software/GPU A/B found whole-song converted-letter `will-change`
  hints amplified the restored emphasis cost. Removing only those hints reduced
  Above-row 95th-percentile frame gaps from about 46–50 ms to 22–24 ms in the
  controlled comparison; effects and timing remain enabled. Original hints are
  unchanged. No-scroller/no-glow controls did not remove that cost.
- Final GPU-enabled broad run: selected converted Classic animation JS p95 at
  most **1.8 ms**; representative sidebar rendered frame-gap p95 **24.4 ms Above**
  and **20.5 ms ruby**, versus **14.4/9.5 ms** for the old build, which suppressed
  converted emphasis. Full-view ruby p95 **12.1 ms** versus **8.6 ms**. These are
  controlled samples, not a claim of native Spotify FPS or zero added cost.
  Full-song Classic mount/seek/toggle/resize spikes still exist; enabling genuine
  additional animation has a measurable cost. Matched no-emphasis cases remain
  cheaper and do not show the discarded layout-thrashing pattern.
- Fixed/responsive-font scroller traces, 80 voices / 400 readings: maximum Word
  layout batches **7.6/10.1 ms**; Line **18.1/17.1 ms**. The burst produces **21/25
  layouts** and zero extra idle batches. Line retains a bounded extra pass and
  uniform wrapped leading. This does not certify every physical monitor/DPI move.
- Build: **27.1 MiB / 9 stylesheets**, dictionary guards pass for all 12 buffers in
  all four generated aliases, and the canonical bundle passes syntax checking.
  All four SHA256 values are
  `0CD890692DEA2D4618CE6B0C0989116D11A2C21FBF18D23F332DD8626DD83DC2`.
  All three installed copies match. The active source is the Roaming Spicetify
  directory; installation used staged/hash-verified files and a rollback backup.
- Native DevTools confirms **5.1.0-local.21**. The current line-synced track mounts
  40 groups / 165 readings; no word timing is claimed for it. Summer Haze / 夏霞
  mounts genuine AMLL word data with **309 distinct timings**, **315 primary
  runs**, and **85 readings**. The reported phrase at approximately 129 s displays
  attached readings and intact source/backing text at narrow and maximized widths.
  Playback samples are diagnostic only: startup/window-focus/accessibility
  capture can affect their frame gaps. Controlled regression/performance results
  and native observations are deliberately separate.
- Native presentation storage remained byte-for-byte unchanged. Config plus five
  checked Comfy/unrelated files retain their pre-install hashes. Playback changed
  during verification, so the latest playing track and playlist view were kept
  instead of restoring the older saved selection. Probe globals were removed,
  observers disconnected, and the temporary DevTools window was verified closed.
- Thai emphasis, broader effect/glow clipping, and background changes remain
  outside this pass. Native Chinese/Korean song playback and the user's physical
  monitor-switch shortcut remain unverified. No commit or push.

## Romaji and reading opacity — 5.1.0-local.20, 2026-10-30

- Restored local.16 / `5fd80ad` is the baseline. Only the two requested corrections
  were reapplied: written-kana Romaji fallback and independent reading opacity.
  The later ruby animation/layout candidates and Thai emphasis are outside this build.
- Full suite: **107/107 passed**, no failures/skips. Standalone Original Classic
  comparison with accepted local.13: **1/1 passed**. Independent real-dictionary
  comparison with `5fd80ad`: **9 cases passed**, preserving all non-text run
  metadata, tokens, source and Kana mappings. Complete decomposed kana input uses
  a private NFC copy; unsafe tokenizer boundaries still fall back safely.
- Independent Chromium opacity check: **108 scenarios / 444 roots passed** across
  source/reading roles, timing and real forced hover. The tracked regression also
  covers inherited/custom policies, all highlight choices, opacity 0/.3/1, Word,
  true/forced Line, profile changes and independently enabled blur. Hover preserves
  the selected opacity; reading Highlight Off remains uniform. Original/Replace
  behavior is preserved. These are controlled fixtures, not native Spotify proof.
- Fresh build succeeded: **27.1 MiB, 9 stylesheets**. All four generated aliases
  passed embedded-dictionary checks and have SHA256
  `1DE798C1BC4C138C79675A58CB0DA74BC95B0AA8A75F327A7FF4B326A85521EB`.
  The installation-turn sandboxed rebuilds hit dictionary-integrity failures with
  Node20 and Node24 before replacing outputs. The unchanged build passed outside
  the sandbox with bundled Node24 and reproduced this exact hash. The intermittent
  failure's cause remains unproven; no build-system or dependency edits were made.
- Installed manually at the user's request, with backups of the previous active
  source/runtime files. Both Spicetify extension directories and Spotify's loaded
  extension file match the local.20 hash above. The existing installer had updated
  the default Local directory while named resolution preferred a stale Roaming
  copy. The user stopped installer work; all attempted installer edits were undone.
- After restarting Spotify, native DevTools executed
  `globalThis.JustEnoughLyrics?.version` and returned `5.1.0-local.20`. Temporary
  DevTools was closed. Client config plus five checked Comfy/unrelated files retain
  exact pre-install hashes. No play/pause/seek or preference changes were issued.
  Manual visual/option-combination checks remain for the user. No commit or push.

## Native review corrections — 5.1.0-local.16, completed 2026-10-29

- Final local.16 full suite: **105/105 passed**, zero failures/skips. Independent
  Original-only Classic comparison against accepted local.13: **1/1 passed**.
  Build and embedded-dictionary checks passed. All four complete bundles and the
  installed canonical file match SHA256
  `47327F4002D45B5EC1527915A3522527717572D0DE8E8B11E3E145D02DDCC816`.
  Transactional installation preserved the exact client-config hash and all six
  checked Comfy/unrelated file hashes.
- Running local.16 was confirmed in native Spotify. On 夏霞 at 129 s, AMLL supplied
  309 genuine word timings. Measured lead and backing source fragments now have
  identical baselines across annotated kanji, plain kana and the trailing `た)`.
  Readings occupy one horizontal line; 君 reads `きみ`, and `こぼ` attaches to 零
  while source `し` stays on the baseline. The narrow view wraps complete units.
- Native Romaji Above produced 33 reading rows for 33 real voices, retaining
  separate lead/backing roles and original text. Measured reading rows are above
  their associated source rows; effective precision remains Word. Relevant native
  controls show Row size and hide Ruby size for Above.
- The final native Kana Replace check retained Word precision and separate
  lead/backing vocals, with zero secondary/ruby rows. Row size and Ruby size both
  have computed display `none`. The reversible probe restored the current
  presentation payload byte-for-byte and restored the playlist view. It issued
  no play/pause/seek calls; ongoing playback and the user's current Furigana choice
  were preserved after the interrupted session. Temporary app probe state was
  removed, and the desktop-control kernel was reset.
- Installed local.15 native inspection found irrelevant Row size/Ruby size controls
  still visible for Romaji/Replace. Their hidden flags were set, but authored
  help-row flex display overrode the browser's hidden rule. A form-scoped hidden
  display rule fixes this. The both-view UI matrix now checks computed display
  and actual layout boxes for Replace/Above/Furigana/language Off, covering size,
  alignment and reading-effect groups. The focused form regression passed 1/1.
- Native local.15 furigana at 129 s showed a separate baseline-propagation defect:
  annotated kanji sat 66.17035 px below plain kana in 56 px lead text and 49.62366 px
  below in 42 px backing text. Readings were horizontal and the captured `た)`
  fragment was internally one line; its previous wrapping defect was not the cause.
- An isolated host-border-box fixture reproduced the lead shift as 66.171875 px.
  Selecting the atomic units' last source baseline corrects the mismatch without
  transforms, font changes, DOM restructuring or altered effect roots. Updated
  tests compare every source glyph bottom within wide and wrapped normal rows,
  with mixed kana/kanji lead plus short/long backing voices, preserved 56/42 px
  fonts, .5/1 reading sizes and every annotation alignment. Existing horizontal
  reading, intrinsic sizing, bounds, long-reading fit and timing checks remain.
  The focused annotation regressions passed 2/2, followed by the final full suite
  and native confirmation above. Ambiguous Japanese readings remain possible;
  converted text retains mapped source intervals, not invented phoneme timing.

## Conversion model and atomic furigana — 5.1.0-local.15, 2026-10-28

This historical source checkpoint was subsequently built and installed as local.15.
Its native findings and the verified local.16 corrections are recorded above;
the passing isolated checks below did not detect the whole source-row baseline
mismatch or the computed hidden-row display defect.

- Parent independent full suite: **105/105 passed, zero failures/skips**. Exact
  Original-only Classic comparison against frozen local.13: **1/1 passed**.
  A final targeted rerun covers the last modal readability/adapter and Off-state
  cleanup edits. Final rebuilt artifact checks and fresh native installation/
  visual checks remain pending at this source checkpoint.

- Schema7 conversion/placement choices are per language and view, with exact raw
  schema6 recovery snapshots on first actual save. Migration precedence, failed
  writes, future schemas, remembered placement, legacy adapters and independent
  text/cue/reading settings are covered by tests.
- Actual bundled Japanese dictionary fixtures cover both reported 君 contexts,
  ASCII/fullwidth parentheses, person-name suffixes, orthographic は/へ particles,
  source ranges and okurigana. This is constrained correction, not perfect lyric
  interpretation; ambiguous alignment omits unsafe furigana.
- Isolated Chromium uses the host global border-box reset and captured native
  font stack/source grouping, including backing 42px `た)`. Assertions require
  single-line horizontal rt, trailing character baseline, intrinsic unit sizing,
  complete bounds, all alignments, large sizes, wide/narrow views, indivisible
  reading fit, same-font-string invalidation and forced-Line progress parity.
  Font availability depends on the machine; this does not certify native Spotify
  pixels or every pronunciation. Fresh native visual validation remains separate.
- Conversion controls apply immediately; disabled/hidden/disconnected controls
  stay inert. Readings retain original source intervals; Above is above each real
  voice. Coalesced font fitting preserves manual grace and releases its listener
  when annotations are Off. No provider/credential/cache/background changes.

## Secondary readings and ruby — 5.1.0-local.14, 2026-10-28

- Source implementation: secondary rows and Japanese ruby per real voice, view
  typography and source-case-specific inherited/custom reading effects. Schema6
  preserves old primary/text/cue choices and defaults new rows/ruby Off. Native
  event controls remain immediate with adjacent help and Classic footers.
- Final full suite: **101/101 passed**, zero failures/skips. Source/store/real
  Chromium regressions cover migrated/independent profiles and channels, pending primary leases
  retained through secondary add/remove, style-only reuse, inactive-case no-op,
  stale/disposed completion and unavailable-reading source fallback.
- The actual-component fixture checks lead plus two real backing voices, exact
  source spaces/punctuation/combining marks/emoji, grouped gap progress, one-span
  line-source ruby with internal safe token boundaries, computed independent
  highlight/scale/blur, full voice scroll bounds, and reading glyph bounds within
  scoped ruby/group reserves at wide and narrow widths. All-Off effects allocate
  no springs or effect writes; disabling removes rows and detached click listeners.
  Existing resize batches preserve the 750ms manual grace and coalesce blur work.
- Final source review accepted all fixes. Exact comparison against accepted `.13`
  Classic passed **1/1** on the final source. These are isolated synthetic browser
  results, not real-song comparative playback or native client font certification.
- Transactional local installation completed after the user resumed the install
  request. The installed canonical file and all four generated artifacts match
  SHA256 `861149E3316FCC4B0DAEDDDEB2432B7496CC93C4CD008EE32FC92C2B4B8829F2`.
  The exact client-config hash and all six checked unrelated/theme file hashes
  were preserved. A rollback backup was retained by the installer.
- Runtime reload, physical native settings inspection and real-song verification
  remain pending. Computer Use remained stopped, so no native `.14` runtime/UI
  result is claimed. Broader containment/clipping and oversized-word layout remain
  later work.

## Four text cases / immediate settings — 5.1.0-local.13, 2026-10-28

- Implemented, source-reviewed and applied locally: four independent source-selected
  text cases, two universal view cue configurations, schema5 migration, immediate
  native-event settings/no Save, whole Now Playing collapse and native case sections.
  Edited legacy values are retained in both migrated text maps; untimed stays plain.
- Final full suite **99/99 passed**, zero failures/skips, after the grace-expiry fix.
  Exact accepted `.12` Syllable/ordinary Line/cue Classic comparison passed1/1.
  The form test uses an isolated owned CDP target with browser focus emulation
  before navigation and strict trusted native-focus assertions; this resolves
  parallel headless focus contention without changing production focus behavior.
  It is not physical-pointer or native desktop focus evidence.
- Actual-component Chromium tests cover animated15-spring cue teardown at0, zero
  hidden margins/blur slots, Line-precision wrappers, and full manual grace after
  physical scrolling stops. The existing750ms callback clears the cue-only guard
  even when expiry occurs in silence, allowing later normal playback reconciliation.
- Native read-only settings inspection passed: four cases/two universal cue configs,
  no Save, disabled Now Playing fully collapsed, visible adjacent help/Classic footer
  and retained custom migration choices. The collapsed overview screenshot was
  inspected. No input/change events or settings-store writes were exercised there.
- Native synthetic components passed all four expected display/finite-style checks:
  Now Playing Word used6springs, Line0; Fullscreen Word displayed as Line used0,
  and Fullscreen Line/Highlight Off wrote0effects. Universal Now Playing dots used
  15springs, then threshold0 left no dots/continuous consumer/updates/writes;
  Fullscreen threshold0 allocated0springs. This is native geometry/counter evidence,
  with no native fixture screenshot or controlled real-song comparison claim.
- All four outputs and the installed canonical file match SHA256
  `9D1639C51EB7CD755BC819C66F6ADBFDBA78405E84D152A1182715F2667BCD53`.
  Current artifacts passed dictionary byte verification. Fresh reload preserved
  current track/route/play state, raw preferences/credential digest and unrelated/
  theme file hashes. The raw presentation schema stayed4 because inspection did
  not edit it; migration is lazy. Owned modal/fixture cleanup was confirmed.
- The user later navigated to the lyric page independently. Validation invoked no
  player/route APIs. Real-song comparative/manual verification remains outstanding;
  existing oversized-word/paint-containment limits are unchanged. No CPU/GPU gain
  or universal visual certification is claimed.

## Text capabilities — 5.1.0-local.12, 2026-10-27

- Implemented, source-reviewed and applied locally. Per-view text presets/detail/
  independent basic effects use presentation schema 4 and a separate rendering
  event channel. Render edits retain source selection, annotation leases, stable
  voice roots and manual-scroll grace. Untimed sources remain plain without an
  extra clock subscription. Background/transport behavior is unchanged.
- Final full suite: **96/96 passed**, zero skips/failures. Standalone real Chromium
  covers roots/roles/click cleanup, detail changes, draft/save isolation, computed
  CSS combinations, Minimal/static-cue zero effects, static-source fallback and
  repeated-time settling. Exact accepted Classic Syllable, Line and cue comparison
  also passed with separate baseline/current styles, non-immediate evolution,
  overlap/gaps/points, repeated timestamps and seeks.
- The comparison exposed that the inherited spring's sleep flag can retain
  velocity. The corrected compatibility path keeps whole active/settling-voice
  spring cadence; spring-free paths remain indexed. Solver/curves are unchanged.
- Native synthetic fixture in the installed font environment passed four cases:
  expected display text/finite styles, zero Classic cadence differences, zero
  Minimal text springs/updates/effect-style writes, and zero internally wrapped
  original shaping runs. This is computed-style/geometry/counter evidence; its
  screenshot was captured after closure and provides no fixture visual proof.
- Native settings draft preview passed Minimal → Glow → Custom, unchanged other
  view draft, title-adjacent visible help and Classic footer. Its screenshot was
  inspected; the owned modal closed without saving. An inactive document required
  a synthetic mouseenter through the actual tooltip trigger, not physical hover.
- Installed `.12` reports one runtime/style/settings button. Preference bytes,
  credential digest, unrelated/theme file hashes and fresh track/route/pause state
  were unchanged. The paused position advanced 10 ms on host resynchronization
  (21,463 → 21,473 ms); no play/seek action was invoked. Four complete build
  outputs and installed canonical file match
  SHA256 `64818605B7B4ED024FE20CA6C231CDC0535527AA029FAF60D59BCDD751D58431`.
- Known oversized-word overflow remains: baseline/current synthetic measurements
  were approximately 133.796 px each. Paint containment is unchanged. Native
  real-song playback still needs the user's manual check; no universal visual,
  clipping or CPU/GPU improvement is claimed.

## Original Thai word wrapping regression — 5.1.0-local.11, 2026-10-27

- Fixed two local.10 regressions: original shaping runs could shrink/wrap internally
  inside a nowrap word, and explicit whitespace could discard a source word-end
  flag. Original runs are atomic again, and coalesced runs retain the final original
  span's exact word flag. Japanese mapped tokens retain their independent wrapping.
- Parent source/test review accepted the narrow patch. All 90 tests passed without
  skips, including oversized grouped Thai, explicit-space word boundaries, opposite/
  RTL layouts, whole-word row changes and the existing narrow Romaji/Kana checks.
- Build/diff checks pass; four local.11 artifacts match SHA256
  `D56FB4092C8FC40048A2037FB65F66EF7DFA8983263F734D5243A2F29FF8F127`.
  Parent installed/reloaded local.11. Live inspection after the user returned to
  the same Thai source found no internally multiline original runs across 72 words
  and no isolated combining-mark letter elements; the reported line appeared
  intact. The user had changed the viewport, so this live result is separate from
  the fixed-width control below.
- Native offscreen reconstruction of the captured 13-run word used the original
  510.922 px width, 47.6864 px font and 56.3567 px line height. Local.10 styling
  reproduced its 169.082 px word height; corrected styling produced one 56.361 px
  row with all runs single-line and exact text retained. The corrected geometry
  matched baseline-like .9 no-wrap styling on that same reconstructed DOM.
  This was not an exact .9 component or source-DTO reconstruction. The owned
  container was removed synchronously without playback/settings/route changes.
- At that narrow width, both corrected and baseline-like styling still overflowed
  by 378.142 px. Oversized provider words retain inherited overflow/clipping;
  resolving that policy remains separate layout work. The regression is fixed
  without claiming all wrapping or clipping problems are solved.

## Safe text and annotations — 5.1.0-local.10, 2026-10-27

- Original source preparation no longer runs converters or tokenizers. Derived
  annotations use cancellable shared leases and a bounded memory cache keyed by
  document identity, actual source content, effective options and converter version.
  Failures retain original text, and stale results cannot update disposed views.
- Thai retains safe provider granularity while split clusters coalesce across
  source boundaries. Complex joining scripts use shaping-word units; safe emphasis
  uses graphemes. Grouped units retain source ranges/intervals, freeze progress in
  timing gaps and do not invent per-character acoustic timing.
- Alternate text settings keep prior saved on/off/language choices and add Japanese
  Romaji/Kana primary form per view. Original appears immediately while contextual
  Japanese readings load; uncertain token alignment falls back to original text.
  Every real backing voice is eligible. The existing voice/scroller objects survive
  text updates, without forcing manual scrolling or changing the background.
- Parent review found no remaining blocking source findings. All 89 tests passed
  without skips, including actual local Japanese dictionary/converter fixtures and
  real Chromium tests for narrow 260 px wrapping, finite CSS, source clusters,
  content cleanup and settings lifecycle.
- Parent executed a same-source synthetic A/B in the actual client using the
  accepted .9 and new components with identical fake clock/font environment:
  Thai isolated mark elements fell from 4 to 0 while retaining four safe runs;
  Latin/Indic isolated marks fell from 1 to 0, Arabic stayed in one connected word,
  emoji kept its complete cluster, and CJK retained its two source runs. Original
  text and finite CSS checks passed. The screenshot showed attached Thai vowels/
  tone marks without changing paint containment. The owned fixture was removed
  without settings, route or playback changes.
- Parent applied/reloaded the reviewed local.10 build. This synthetic component
  comparison is separate from visual verification on the reported affected song;
  that real-song check and normal Japanese viewing remain user validation items.
  The owned Japanese settings draft preview passed: Alternate text/Japanese labels,
  Romaji/Kana choices with default Romaji, connected nested layout and visible
  question-mark help with Classic: Romaji footer. The inactive client required a
  synthetic mouseenter to exercise installed Tippy, so this is not a physical
  pointer/keyboard-focus claim. The preview did not Save, and owned close confirmed
  unchanged settings without relinquishing ownership.
- Final runtime checks confirmed local.10 ready with one stylesheet/settings
  button. Behavior, legacy view and presentation bytes plus the credential digest
  matched the fresh pre-install baseline; all six sampled Comfy/unrelated extension
  files remained unchanged. No player, route, source-selection or Save actions were
  used for these native previews.
- Outstanding user checks: inspect the reported Thai song at 0:32, 0:42 and 1:17,
  and Japanese Romaji/Kana during normal playback. Separate converter/browser/
  synthetic A/B evidence does not establish that end-to-end real-song result.
- Build/diff checks pass; four full local.10 artifacts match SHA256
  `9387DC8A4B9FF8E5C1AAAE24E25BEE852EF7BC790ED1D7B766741F66362BA8EC`.
  No measured performance improvement or universal script/font certification is
  claimed. Ruby/secondary rows and later rendering controls remain future work.

## Settings help — 5.1.0-local.9, 2026-10-27

- Shared Lyric delay (s) now belongs to Behavior; each view keeps Delay offset (s).
  IDs, signed seconds, saved values and draft Save behavior are unchanged.
- Title-adjacent question buttons provide hover/focus/click help. Classic defaults
  appear at the bottom of tooltips; repeated reset buttons and explanatory blocks
  were removed. Errors, read-only warnings and save status remain visible.
- Help buttons are separate from native labels. Tooltips are destroyed on modal
  close/replacement and extension disposal without observers or polling; a disposed
  connected form cannot submit or navigate.
- Parent review accepted the final source, styles, test and preview helpers with
  no remaining findings. The full 77-test suite passed before the final CSS-only
  switch alignment fix; the strengthened standalone Chromium test then passed
  with both switches within 1 px of the row's right padding. That source harness
  uses synthetic storage, real native focus/labels/custom-element lifecycle and
  substitute modal/Tippy host services. Review resolved both the margin cascade
  and disposed-form native-submission findings.
  Build and diff check pass. Installed local.9 and four full outputs match
  SHA256 `A753B58F75D00D6F79750EEB8B407C6EA7C9CD378F1AC749A257CAF5DB704F17`.
- Final native preview and screenshot confirmed compact sections, title-adjacent
  help, right-aligned Romanization switches, visible tooltip with Classic: 0 s
  footer, and no reset widgets. The inactive/hidden client did not deliver the
  programmatic focus trigger; a synthetic mouseenter exercised the real installed
  Tippy handler and produced a visible mounted tooltip. This is installed display
  evidence, not proof of physical pointer or keyboard focus behavior in that state.
  The close helper closed only its owned modal; settings remained unchanged and
  ownership was never relinquished. No Save or playback changes were exercised.
  A final runtime snapshot confirmed one stylesheet/settings button and matched
  behavior, legacy view and presentation bytes plus the credential digest to the
  fresh pre-install baseline.

## Immutable timing core — 5.1.0-local.8, 2026-10-27

- Added deterministic tests for immutable source identity/provenance, every backing
  voice, cue union, inclusive/instantaneous timing, forward/backward seeks, gaps,
  additive signed offsets and inverse/clamped lyric clicks.
- Synthetic host tests run the actual renderer orchestration with a fake clock
  and visual components, checking indexed frame work, settling, paused offset
  updates, scope isolation, batched saves and cleanup. A separate test runs the
  actual Classic line animator and checks finite CSS values for instant lines.
- All 76 tests passed in the parent's unrestricted run; nine cover the timing
  core. Build and diff checks pass, and parent review accepted the core.
  These are offline checks; native visual parity and measured CPU/GPU improvements
  are not established.
- Parent applied the reviewed local.8 build and confirmed one runtime style,
  settings button and canonical script. The reviewed native save/restore smoke
  loaded the current track with 27 vocals, one active vocal and one background.
  Full Lyrics +0.5 seconds saved while the existing renderer and selected source
  objects were retained; shared/Now Playing delays remained unchanged. Restoring
  through the live settings store and restoring exact original storage bytes both
  passed. This verifies timing/settings wiring, not visual parity or speedups.
  Installed build and all four full artifacts match SHA256
  `9D1FF4BF4A1EDCD41B4EDA82F06470386A784301BF00C1F650B32714A43E7DF2`.
- Shared and per-view lyric delay controls use seconds: positive means lyrics
  later. Each view adds its delay to the shared value. Restore Classic timing
  resets only that control's draft to zero; Save applies the draft.
- Historical next step at this checkpoint was Unicode-safe shaping and
  demand-driven annotations; those changes are implemented in local.10 above.

## Settings grouping — 5.1.0-local.7, 2026-10-27

- 67 tests passed. Build, dictionary, syntax and diff checks passed; all four
  complete build outputs match.
- Independent master switches nest Romanization inside each view section.
  Schema 1/legacy migration retains effective choices; master Off preserves the
  language map while disabling its output. Inline enable and scoped reset tested.
- Synthetic-storage Chromium form checks passed for draft expansion, Save,
  remembered choices, reset, future-schema read-only behavior and zero provider
  invalidation. The form was detached and submit events were dispatched explicitly.
- Applied locally and running as local.7. Inspected actual collapsed and expanded
  modal screenshots alongside Comfy: connected header/options card, subordinate
  language labels and independent Now Playing/Full Lyrics sections.
- Preview changes were not saved. Final raw settings/legacy values and credential
  digest matched the fresh pre-install snapshot; one stylesheet/settings button.

## Just Enough Lyrics 5.1.0-local.6 — 2026-10-27

- 65 automated tests passed, including independent profile migration/reset,
  provider versus demand notifications, both alias load orders, partial import
  and readiness failure cleanup, real shared-view initialization, and isolated
  Windows installer success/rollback cases with each injected stage verified.
- Build/dictionary verification, syntax and diff checks passed. All four
  canonical/compatibility artifacts contain identical complete bundles.
- Applied locally on Windows through the transactional filename migration.
  Runtime reports Just Enough Lyrics/local.6, with one script registration,
  stylesheet and settings button. Both diagnostic names identify one instance.
- Live lyric-page check loaded a 49-vocal source and one background. Saving a
  Now Playing language change retained the Full Lyrics renderer and selected
  source; the tested preference was restored. Provider behavior, legacy settings
  and credential digest matched their baselines.
- Installed Comfy CSS/script/palette and three unrelated extension files retained
  their pre-install hashes. Accepted/new lyric stylesheet bytes are identical.
- The pre-install screenshot was taken after user navigation and shows a
  playlist. It is not a controlled visual comparison. Native appearance parity
  and long-term performance remain unverified; no speedup is claimed.

## 5.1.0-local.5 — 2026-10-26

Automated tests cover provider failure isolation, native Spotify response parsing,
cache reuse, missing/invalid/stale responses, credential-only cache invalidation,
shared debounce, timing overlaps, dictionary integrity and local helper lifecycle.
Builds verify bundled dictionary strings before and after writing the artifact.

Spotify integration uses the already authenticated client transport. Line-only
responses do not receive a word-sync label; parser failures cannot suppress other
sources. Successful provider records are reused without new network requests.

Checks completed:

- `npm test`: 47 passed, zero failed.
- `npm run build`: self-contained 27.0 MiB artifact, dictionary verification passed.
- Installed through the preservation-checking Windows installer; running version
  reports `5.1.0-local.5`. Spicetify reports 2.46.2.
- A native Spotify request for `6Ft1XuvNszzYKUzWYK67VR` returned 50 line events.
  The new parser produced 49 nonblank vocal lines, retaining blank-event boundaries.
  This probe did not change playback; it checks transport and parsing, not a
  full-track listening comparison.
- The current recording `4lSeleVXbI78Do2KzmqJpv` had no Spotify candidate. Other
  successful sources still rendered despite Musixmatch's 401/cooldown warning.
- Source picker and settings remained usable. Restored on-demand fetching, all
  enabled sources, and the user's disabled-sidebar preference afterward.

## Initial sidebar investigation

With valid lyrics loaded, the current Now Playing anchor existed but the custom
card was absent. Disabling/re-enabling the integration after the DOM had mounted
created the card immediately. Its Show lyrics control expanded and rendered the
lyrics alongside the current Comfy theme. Disabling removed the card again.

The code observes the sidebar root and selected immediate children, but misses
deeper replacement/mount events. After an unsuccessful anchor lookup it otherwise
relies on a song change to retry. The observed recovery strongly supports this
lifecycle gap as the cause; it is not evidence that every sidebar failure shares
one cause. A future fix should watch the narrow Now Playing mount boundary, with
coalesced checks and explicit cleanup, rather than scan the application continuously.

Native macOS/Linux runtime behavior is not certified by Windows test results.
No long-term performance benchmark or exhaustive console-error audit was performed.

## Settings and sidebar follow-up — 2026-10-26

- Matched Comfy's measured 550 px modal, 24 px section headings, 16 px labels,
  tiled controls and 16 px host content margins; removed the nested scrollbar.
- Moved the sidebar switch to Now Playing / Enabled. It controls both the
  existing fetch-demand gate and the sidebar watcher/card lifecycle.
- Replaced shallow mount observation with filtered, coalesced sidebar child-list
  observation. Animation attributes/text are not observed, and mutations inside
  the lyric card are ignored before any selector scan.
- Live controlled removal of Now Playing's aside cleaned its detached card;
  reattaching produced exactly one card. Unrelated widget mutations preserved
  card identity. Expansion rendered lyrics; disabling prevented recreation.
- All 47 regression tests passed. Both generated artifacts rebuilt and had
  identical SHA-256 hashes. Applied to Spotify; restored the user's preferences.
