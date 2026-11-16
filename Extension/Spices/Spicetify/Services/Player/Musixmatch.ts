import { SpotifyInternalFetch } from '../Session.ts';
import { convertRichsync, convertSubtitles } from './MusixmatchLyrics.mjs';
import type { ProviderLyrics } from './LyricUtilities.ts';

const BaseURL = 'https://apic-appmobile.musixmatch.com/ws/1.1/';
const TokenKey = 'BeautifulLyricsLocal/MusixmatchToken';
const CooldownKey = 'BeautifulLyricsLocal/MusixmatchCooldown';
// Match the direct provider transport used by Spicetify Lyrics Plus. Spotify's
// access token is neither needed nor sent to this service.
const Headers = {
  'X-Cookie': 'x-mxm-token-guid=', 'x-mxm-app-version': '10.1.1',
  'X-User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
  Accept: 'application/json',
};
let tokenPromise: Promise<string> | undefined;
let nextRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
// Missing track metadata cannot establish a different recording. Keep this
// distinct from an authoritative miss, without attaching unverified lyrics.
export const UnverifiedMusixmatchRecording = Symbol('Unverified Musixmatch recording');
type MusixmatchResult = ProviderLyrics | undefined | typeof UnverifiedMusixmatchRecording;
const pending = new Map<string, { Job: Promise<MusixmatchResult>; Callers: Set<() => boolean> }>();
// Fallbacks remain usable for this lookup, but a transient outage must not
// freeze a lower-quality result on disk for 30 days. Keep policy off the data.
const transientFallbacks = new WeakSet<ProviderLyrics>();
export const IsMusixmatchResultCacheable = (lyrics: MusixmatchResult) => lyrics !== UnverifiedMusixmatchRecording && (!lyrics || !transientFallbacks.has(lyrics));

function fail(status: number): never {
  // Authentication failures can also mean quota exhaustion. Never rotate tokens
  // in a retry loop. Persist a cooldown so a reload does not hammer the service.
  if ([401, 402, 403, 429].includes(status)) {
    localStorage.setItem(CooldownKey, String(Date.now() + 15 * 60_000));
    if (status === 401) localStorage.removeItem(TokenKey);
  }
  throw new Error(`Musixmatch returned ${status}; ${[401,402,403,429].includes(status) ? 'requests paused for 15 minutes' : 'lyrics unavailable'}`);
}

async function request(endpoint: string, params: Record<string, string> = {}, isCurrent: () => boolean = () => true) {
  if (Date.now() < Number(localStorage.getItem(CooldownKey) || 0)) {
    throw new Error('Musixmatch is cooling down after an access/rate-limit error');
  }
  const delay = nextRequestAt - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  // A song can change while waiting for the provider-specific quota spacing.
  if (!isCurrent()) throw new Error("Track changed before lyric lookup");
  nextRequestAt = Date.now() + 2000;
  const query = new URLSearchParams({ format: 'json', app_id: 'mac-ios-v2.0', ...params });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: any;
  try {
    response = await Promise.race([
      SpotifyInternalFetch.get(`${BaseURL}${endpoint}?${query}`, null, Headers),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20_000); }),
    ]);
  } catch {
    // Do not log the transport error: it can contain the token-bearing URL.
    localStorage.setItem(CooldownKey, String(Date.now() + 60_000));
    throw new Error('Musixmatch connection failed; requests paused for one minute');
  } finally {
    clearTimeout(timer);
  }
  const status = response?.message?.header?.status_code;
  if (status !== 200) fail(status ?? 0);
  return response.message.body;
}

async function getToken(isCurrent: () => boolean): Promise<string> {
  const saved = localStorage.getItem(TokenKey);
  if (saved) return saved;
  // One token acquisition per concurrent group, retained across Spotify reloads.
  return tokenPromise ??= request('token.get', {}, isCurrent).then(body => {
    if (typeof body?.user_token !== 'string' || !body.user_token || body.user_token.startsWith('UpgradeOnly')) fail(403);
    localStorage.setItem(TokenKey, body.user_token);
    return body.user_token;
  }).finally(() => { tokenPromise = undefined; });
}

export function FetchMusixmatchLyrics(track: { uri: string; name: string; artists: { name: string }[]; album: { name: string } }, duration: number, isCurrent: () => boolean, isrc = '', cacheGeneration = 0): Promise<MusixmatchResult> {
  // A lookup after Clear must not join the old generation's pending response.
  const pendingKey = track.uri + ':' + cacheGeneration;
  const existing = pending.get(pendingKey);
  if (existing) { existing.Callers.add(isCurrent); return existing.Job; }
  // Closing/reopening a demanded view can retire the first caller while the
  // same song still has a current consumer. Share one job and quota delay, but
  // do not let that retired caller cancel everyone who joined it afterwards.
  const callers = new Set([isCurrent]);
  const anyCurrent = () => {
    for (const current of callers) if (current()) return true;
    return false;
  };
  const job = queue.catch(() => {}).then(async (): Promise<MusixmatchResult> => {
    // Rapid skips should not queue requests for songs that have already gone.
    if (!anyCurrent()) throw new Error('Track changed before lyric lookup');
    const token = await getToken(anyCurrent);
    if (!anyCurrent()) throw new Error('Track changed before lyric lookup');
    const body = await request('macro.subtitles.get', {
      namespace: 'lyrics_richsynched', subtitle_format: 'mxm',
      q_track: track.name, q_artist: track.artists.map(artist => artist.name).join(', '),
      q_album: track.album.name, track_spotify_id: track.uri,
      ...(isrc ? { track_isrc: isrc } : {}),
      q_duration: String(duration), f_subtitle_length: String(Math.floor(duration)),
      usertoken: token, optional_calls: 'track.richsync', richsync_compact_type: 'words',
    }, anyCurrent);
    const calls = body?.macro_calls;
    const match = calls?.['matcher.track.get']?.message;
    if (match?.header?.status_code === 404) return undefined;
    if (match?.header?.status_code !== 200) fail(match?.header?.status_code ?? 0);
    const meta = match.body?.track;
    if (meta?.restricted || calls?.['track.lyrics.get']?.message?.body?.lyrics?.restricted) fail(403);
    if (meta?.instrumental) return undefined;
    // Avoid attaching a similarly named recording to the wrong Spotify track.
    const id = track.uri.split(':').at(-1);
    // Re-releases can have different Spotify IDs but the same recording ISRC.
    const sameRecording = isrc && (meta?.track_isrc === isrc || meta?.commontrack_isrcs?.flat().includes(isrc));
    if (meta?.track_spotify_id !== id && !meta?.commontrack_spotify_ids?.includes(id) && !sameRecording) {
      return isrc ? undefined : UnverifiedMusixmatchRecording;
    }
    const rich = calls?.['track.richsync.get']?.message;
    const subtitles = calls?.['track.subtitles.get']?.message;
    const plain = calls?.['track.lyrics.get']?.message;
    // lyrics.get access denial is a provider failure, never an absent lyric.
    if (plain && [401,402,403,429].includes(plain.header?.status_code)) fail(plain.header.status_code);
    if (rich?.header?.status_code === 200 && rich.body?.richsync?.richsync_body) {
      const converted = convertRichsync(JSON.parse(rich.body.richsync.richsync_body));
      if (converted) return converted as ProviderLyrics;
    }
    // Preserve rich/subtitle access handling on the existing fallback path.
    for (const call of [rich, subtitles]) {
      if (call && [401,402,403,429].includes(call.header?.status_code)) fail(call.header.status_code);
    }
    const transient = [rich, subtitles, plain].some(call => call && ![200, 404].includes(call.header?.status_code));
    const fallback = (lyrics: ProviderLyrics | undefined) => {
      if (transient) {
        if (!lyrics) throw new Error('Musixmatch timing temporarily unavailable');
        transientFallbacks.add(lyrics);
      }
      return lyrics;
    };
    const subtitle = subtitles?.body?.subtitle_list?.[0]?.subtitle;
    if (subtitle?.subtitle_body) return fallback(convertSubtitles(JSON.parse(subtitle.subtitle_body), duration) as ProviderLyrics);
    const text = plain?.body?.lyrics?.lyrics_body;
    if (typeof text === 'string') {
      const lines = text.split(/\r?\n/).filter(line => line.trim()).map(Text => ({ Text }));
      if (lines.length) return fallback({ Type: 'Static', Lines: lines } as ProviderLyrics);
    }
    return fallback(undefined);
  }).finally(() => pending.delete(pendingKey));
  queue = job;
  pending.set(pendingKey, { Job: job, Callers: callers });
  return job;
}
