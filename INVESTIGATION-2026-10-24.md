# Follow-up investigation — Spotify and language views (2026-10-24)

No Spotify provider, cache redesign, romanization behavior change, or progressive
provider rendering was implemented in this pass. Proxy lifecycle only was changed.

## Spotify provider feasibility
The installed Lyrics Plus uses CosmosAsync.get against
https://spclient.wg.spotify.com/color-lyrics/v2/track/<id>?format=json&vocalRemoval=false&market=from_token
with the existing Spotify session. This is a Spotify client endpoint, not a
contracted public Web API lyrics endpoint. No separate developer key or relay
was required by our live probes; Spotify session credentials must remain on the
Spotify transport, never on the Spicy relay.

Live responses, without changing playback:
- GHOST / 6Ft1XuvNszzYKUzWYK67VR: LINE_SYNCED, MusixMatch, 50 lines, 0 syllables.
- 3Qk92ozKLvbNyFMwkjNPfO: UNSYNCED, MusixMatch, 56 lines, 0 syllables.
- Then-current 15Rj8v80X171RLRGSKluGg: LINE_SYNCED, MusixMatch, 27 lines, 0 syllables.
All three returned JSON. Lines have startTimeMs, words, syllables, endTimeMs and
transliteratedWords. All sampled endTimeMs values were zero. Metadata includes
language, alternatives and translationLanguages; field presence does not prove
that transliteration/translation data is populated or usable.

Recommended future plumbing: validated Spotify track IDs, current ID first and
canonical ID as a bounded fallback; native authenticated transport; shared demand
and debounce gate; independent cache/cooldown/provider toggle; Line/Static adapter.
Convert millisecond strings to finite seconds, infer display end boundaries from
next line/track duration (do not claim original end timing), preserve empty/music
boundaries, reject malformed/unknown sync modes. No word timing should be invented.
Local files require a separate recording-resolution step before this endpoint.
Use 404 as absence, 401/403 as access failure, and 429 as cooldown. Exact quotas
were not measured; Premium does not imply no rate limit. This provider is useful
for line fallback and an independent access path, not demonstrated extra richsync.

Primary references:
- https://spicetify.app/docs/development/api-wrapper/methods/cosmos-async
- Installed spicetify-routes-lyrics-plus.js, Providers.spotify.
- https://developer.spotify.com/documentation/web-api/reference

## Romanization: actual execution path
1. Player/mod.ts retrieves candidates and prepares each one sequentially unless
   its transformed cache exists. Spicy deliberately has no persistent transformed
   cache, so it undergoes this preparation again on lookup.
2. LyricUtilities.ts joins native text and uses franc for a primary language.
3. Every line/lead segment is passed to GenerateRomanization, regardless of the
   user's display toggle. Japanese uses primary jpn OR a kana regex, Korean uses
   primary kor OR Hangul detection, Chinese uses primary cmn OR Han characters.
4. Japanese triggers GetRomaji: lazy, once-per-session initialization of the
   bundled Kuromoji dictionary, then Kuroshiro romaji conversion. The dictionary
   is lazy by language, NOT by the user's request to see romanization.
5. All conversion promises must resolve before interludes are added and lyrics
   are returned. One conversion/init rejection discards that candidate. A rejected
   RomajiPromise is retained for the session. Native lyrics depend unnecessarily
   on optional presentation processing.
6. Renderer components choose RomanizedText versus Text at display time. The
   saved per-language toggle defaults to false and changes only this selection.

Further limitations confirmed in code:
- Timed syllables are converted independently. This loses whole-word/line context
  for Japanese readings; the same kanji may need different readings by context.
- Only Background[0] gets romanized, although all backing voices are rendered.
- A single RomanizedLanguage flag represents a whole song. Mixed-script content
  can overwrite that flag as asynchronous conversions finish; it is not a robust
  per-line language model.
- Only Text/RomanizedText strings are retained. Token readings/character ranges
  needed for ruby/furigana are not retained in the lyric model. Kuromoji exposes
  readings, so reuse is possible, but it needs alignment rather than just a toggle.
- No translation backend or translation layout exists in this path. Transliteration
  is not translation. Converting segments changes displayed character counts,
  which also changes existing visual character staggering/emphasis decisions.

Recommended future design: native timed lyrics ready first; optional annotation
layer computed only for the requested mode, keyed by provider/content fingerprint,
annotation language/mode and converter version. Tokenize a whole line with context,
map reading spans back to source character ranges and timing segments; ambiguous
alignment must degrade gracefully. Keep timing on the native segments. Ruby spans
for inline furigana; independent secondary line for kana/romaji/translation. Scope
layout measurements to real text/layout changes via the existing resize lifecycle.
Annotation errors must leave native lyrics visible. Translation requests only when
selected; don't eagerly convert all provider alternatives. Dictionary loading and
annotation promises should coalesce with controlled retry after failures.

## Responses to the other audit proposals
- Exact 30-day positive TTL is clear: savedAt + 30*24*60*60*1000, not calendar month
  arithmetic. Decide whether 'cache exists' means each provider's fresh record or
  any result for a track: the latter prevents discovering a new/better provider.
  Recommend per-provider valid records. A 404 cached for 30 days locks out later
  uploads/matching improvements; short negative caching is preferable.
- Clear-all must target Beautiful Lyrics namespaces only, preserving credentials,
  preferences and Comfy. Track clear must include provider variants/canonical IDs,
  transformed entries and memory copies. Old in-flight requests need generation
  invalidation so they cannot immediately repopulate deleted entries.
- Spicy memory-only response handling and its retention terms need an explicit
  decision before making all providers persist 30 days. No change made here.
- Delaying progressive results is reasonable until observed latency warrants it.
- Spicy clearing on every settings change is an implementation regression from
  expanding a previously token-specific event into a general settings event.
  Future fix: distinguish token/source changes from display/fetch/sidebar settings.
