import { GetExpireStore } from '../Cache.ts';
import { FetchMusixmatchLyrics, IsMusixmatchResultCacheable, UnverifiedMusixmatchRecording } from './Musixmatch.ts';
import { FetchLrclib, FetchSpicy } from './AdditionalProviders.ts';
import { FetchSpotify, GetSpotifyCacheGeneration } from './SpotifyProvider.ts';
import { IsProviderEnabled, Providers } from './ProviderSettings.ts';
import { IsCachedLyrics } from './CachedLyrics.ts';
import { validateLyrics, compareCandidates, hasWordTiming } from './ProviderFormats.mjs';
import { convertAmll } from './AmllLyrics.mjs';
import { uniqueTimingCount, lyricFingerprint } from './LyricTiming.mjs';
import type { ProviderLyrics } from './LyricUtilities.ts';

const musixmatch = GetExpireStore<ProviderLyrics | false>('BeautifulLyricsLocal_Musixmatch', 2, { Duration: 30, Unit: 'Days' }, true, IsCachedLyrics);
const amll = GetExpireStore<ProviderLyrics | false>('BeautifulLyricsLocal_AMLL', 1, { Duration: 14, Unit: 'Days' }, true, IsCachedLyrics);
let amllRetryAt = 0;
export const ResetAmllCooldown = () => { amllRetryAt = 0; };

export function amllTrackIds(uri: string, canonical?: string) {
  // AMLL's repository is indexed by platform ID, not fuzzy name search. Check
  // both editions without guessing translations or transliterations of titles.
  return [...new Set([uri, canonical].filter((s): s is string => !!s && /^spotify:track:[A-Za-z0-9]{22}$/.test(s)).map(s => s.split(':')[2]))];
}

async function fetchAmll(id: string, duration: number, isCurrent: () => boolean, generation: number) {
  const cached = await amll.GetItem(id);
  if (cached !== undefined) return cached || undefined;
  if (!isCurrent()) throw new Error('Track changed before AMLL lookup');
  if (Date.now() < amllRetryAt) throw new Error('AMLL requests cooling down');
  const response = await fetch(`https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/spotify-lyrics/${id}.ttml`, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) {
    await amll.SetItem(id, false, generation);
    return undefined;
  }
  if (!response.ok) {
    amllRetryAt = Date.now() + 60_000;
    throw new Error(`AMLL returned ${response.status}`);
  }
  const lyrics = convertAmll(await response.text(), duration) as ProviderLyrics | undefined;
  if (lyrics) await amll.SetItem(id, lyrics, generation);
  return lyrics;
}

export type ProviderOutcome = { Provider: typeof Providers[number]; State: 'found' | 'none' | 'failed' | 'disabled'; Reason?: string };
export async function FetchLyricLookup(track: Parameters<typeof FetchMusixmatchLyrics>[0], duration: number, isCurrent: () => boolean, isrc = '', canonical?: string) {
  if (!isCurrent()) throw new Error('Track changed before lyric lookup');
  const candidates: { provider: string; trackId: string; lyrics: ProviderLyrics; timings: number }[] = [];
  const warnings: string[] = [];
  const spotifyGeneration = GetSpotifyCacheGeneration(), amllGeneration = amll.GetGeneration();
  const outcomes: ProviderOutcome[] = Providers.map(Provider => ({ Provider, State: IsProviderEnabled(Provider) ? 'none' : 'disabled' }));
  const failed = (provider: string, reason: string) => {
    warnings.push(`${provider}: ${reason}`);
    const outcome = outcomes.find(o => o.Provider === provider)!;
    outcome.State = 'failed';
    outcome.Reason = outcome.Reason ? `${outcome.Reason}; ${reason}` : reason;
  };
  const jobs = [
    (async () => {
      if (!IsProviderEnabled('Spotify')) return;
      // Try the current release first. Only an absent result tries its canonical
      // recording; access failures must not multiply requests across aliases.
      for (const id of amllTrackIds(track.uri, canonical)) {
        const lyrics = await FetchSpotify(id,duration,isCurrent,spotifyGeneration);
        if (lyrics) { candidates.push({provider:'Spotify',trackId:id,lyrics,timings:uniqueTimingCount(lyrics)}); break; }
      }
    })().catch(error=>failed('Spotify', error.message)),
    (async () => {
      if (!IsProviderEnabled('Musixmatch')) return;
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri)) return;
      const id = track.uri.split(':')[2];
      const generation = musixmatch.GetGeneration();
      let lyrics = await musixmatch.GetItem(id);
      if (lyrics === undefined) {
        const result = await FetchMusixmatchLyrics(track, duration, isCurrent, isrc, generation);
        if (result === UnverifiedMusixmatchRecording) return;
        lyrics = result || false;
        if (IsMusixmatchResultCacheable(result)) await musixmatch.SetItem(id, lyrics, generation);
      }
      if (lyrics) candidates.push({ provider: 'Musixmatch', trackId: id, lyrics, timings: uniqueTimingCount(lyrics) });
    })().catch(error => failed('Musixmatch', error.message)),
    (async () => {
      if (!IsProviderEnabled('AMLL')) return;
      for (const id of amllTrackIds(track.uri, canonical)) {
        if (!isCurrent()) break;
        // One failed alias must not prevent checking the other edition.
        try {
          const lyrics = await fetchAmll(id, duration, isCurrent, amllGeneration);
          if (lyrics) candidates.push({ provider: 'AMLL', trackId: id, lyrics, timings: uniqueTimingCount(lyrics) });
        } catch (error) { failed('AMLL', (error as Error).message); }
      }
    })(),
    (async () => {
      if (!IsProviderEnabled('LRCLIB')) return;
      const lyrics = await FetchLrclib(track, duration, isCurrent);
      if (lyrics) candidates.push({provider:'LRCLIB',trackId:track.uri,lyrics,timings:uniqueTimingCount(lyrics)});
    })().catch(error=>failed('LRCLIB', error.message)),
    (async () => {
      if (!IsProviderEnabled('Spicy')) return;
      const id = amllTrackIds(track.uri)[0];
      if (!id) return;
      const lyrics = await FetchSpicy(id, duration, isCurrent);
      if (lyrics) candidates.push({provider:'Spicy',trackId:id,lyrics,timings:uniqueTimingCount(lyrics)});
    })().catch(error=>failed('Spicy', error.message)),
  ];
  await Promise.all(jobs);
  if (!isCurrent()) throw new Error('Track changed during lyric lookup');
  const valid = candidates.filter(candidate => {
    try {
      const checked = validateLyrics(candidate.lyrics,duration);
      if (!checked) { failed(candidate.provider, 'invalid lyric data'); return false; }
      candidate.lyrics = {...checked,...((candidate.lyrics as any).Attribution ? {Attribution:(candidate.lyrics as any).Attribution} : {})};
      return true;
    } catch { failed(candidate.provider, 'invalid lyric data'); return false; }
  }).sort(compareCandidates);
  // Multiple AMLL edition IDs are candidates internally; the picker exposes the
  // best usable result from each provider rather than duplicate provider names.
  const chosen = valid.filter((c,i)=>valid.findIndex(v=>v.provider===c.provider)===i);
  for (const candidate of chosen) {
    const outcome = outcomes.find(o => o.Provider === candidate.provider)!;
    outcome.State = 'found';
    delete outcome.Reason;
  }
  const enabled = outcomes.filter(o => o.State !== 'disabled');
  const error = enabled.length && enabled.every(o => o.State === 'failed') ? warnings.join('; ') : undefined;
  const summaries = chosen.map(c=>({Provider:c.provider,TrackId:c.trackId,UniqueTimings:c.timings,Type:c.lyrics.Type}));
  const lyrics = chosen.map(c=>({...c.lyrics,Source:{Provider:c.provider,TrackId:c.trackId,UniqueTimings:c.timings,HasWordSync:hasWordTiming(c.lyrics),
    CacheKey:`${c.provider}-${c.trackId}-${lyricFingerprint(c.lyrics)}`,Candidates:summaries,Warnings:warnings}}));
  return { Candidates: lyrics as ProviderLyrics[], Outcomes: outcomes, Error: error };
}

export async function FetchLyricCandidates(...args: Parameters<typeof FetchLyricLookup>): Promise<ProviderLyrics[]> {
  const result = await FetchLyricLookup(...args);
  if (result.Error) throw new Error(result.Error);
  return result.Candidates;
}

// Compatibility for callers which only need the automatically selected result.
export async function FetchLyrics(...args: Parameters<typeof FetchLyricCandidates>) {
  return (await FetchLyricCandidates(...args))[0];
}
