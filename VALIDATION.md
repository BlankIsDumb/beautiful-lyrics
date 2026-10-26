# Validation

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

## Sidebar investigation (not fixed in this pass)

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
