# Validation

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
