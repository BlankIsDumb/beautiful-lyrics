import { GetExpireStore } from '../Cache.ts';
import { FetchMusixmatchLyrics } from './Musixmatch.ts';
import { FetchLrclib, FetchSpicy } from './AdditionalProviders.ts';
import { IsProviderEnabled } from './ProviderSettings.ts';
import { validateLyrics, compareCandidates, hasWordTiming } from './ProviderFormats.mjs';
import { convertAmll } from './AmllLyrics.mjs';
import { uniqueTimingCount, lyricFingerprint } from './LyricTiming.mjs';
import type { ProviderLyrics } from './LyricUtilities.ts';

const musixmatch = GetExpireStore<ProviderLyrics | false>('BeautifulLyricsLocal_Musixmatch', 2, { Duration: 1, Unit: 'Months' }, true);
const amll = GetExpireStore<ProviderLyrics | false>('BeautifulLyricsLocal_AMLL', 1, { Duration: 2, Unit: 'Weeks' }, true);
let amllRetryAt = 0;

export function amllTrackIds(uri: string, canonical?: string) {
  // AMLL's repository is indexed by platform ID, not fuzzy name search. Check
  // both editions without guessing translations or transliterations of titles.
  return [...new Set([uri, canonical].filter((s): s is string => !!s && /^spotify:track:[A-Za-z0-9]{22}$/.test(s)).map(s => s.split(':')[2]))];
}

async function fetchAmll(id: string, duration: number, isCurrent: () => boolean) {
  const cached = await amll.GetItem(id);
  if (cached !== undefined) return cached || undefined;
  if (!isCurrent()) throw new Error('Track changed before AMLL lookup');
  if (Date.now() < amllRetryAt) throw new Error('AMLL requests cooling down');
  const response = await fetch(`https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/spotify-lyrics/${id}.ttml`, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) {
    await amll.SetItem(id, false);
    return undefined;
  }
  if (!response.ok) {
    amllRetryAt = Date.now() + 60_000;
    throw new Error(`AMLL returned ${response.status}`);
  }
  const lyrics = convertAmll(await response.text(), duration) as ProviderLyrics | undefined;
  if (lyrics) await amll.SetItem(id, lyrics);
  return lyrics;
}

export async function FetchLyricCandidates(track: Parameters<typeof FetchMusixmatchLyrics>[0], duration: number, isCurrent: () => boolean, isrc = '', canonical?: string): Promise<ProviderLyrics[]> {
  if (!isCurrent()) throw new Error('Track changed before lyric lookup');
  const candidates: { provider: string; trackId: string; lyrics: ProviderLyrics; timings: number }[] = [];
  const warnings: string[] = [];
  const jobs = [
    (async () => {
      if (!IsProviderEnabled('Musixmatch')) return;
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri)) return;
      const id = track.uri.split(':')[2];
      let lyrics = await musixmatch.GetItem(id);
      if (lyrics === undefined) {
        lyrics = await FetchMusixmatchLyrics(track, duration, isCurrent, isrc) || false;
        await musixmatch.SetItem(id, lyrics);
      }
      if (lyrics) candidates.push({ provider: 'Musixmatch', trackId: id, lyrics, timings: uniqueTimingCount(lyrics) });
    })().catch(error => warnings.push(`Musixmatch: ${error.message}`)),
    (async () => {
      if (!IsProviderEnabled('AMLL')) return;
      for (const id of amllTrackIds(track.uri, canonical)) {
        if (!isCurrent()) break;
        // One failed alias must not prevent checking the other edition.
        try {
          const lyrics = await fetchAmll(id, duration, isCurrent);
          if (lyrics) candidates.push({ provider: 'AMLL', trackId: id, lyrics, timings: uniqueTimingCount(lyrics) });
        } catch (error) { warnings.push(`AMLL: ${(error as Error).message}`); }
      }
    })(),
    (async () => {
      if (!IsProviderEnabled('LRCLIB')) return;
      const lyrics = await FetchLrclib(track, duration, isCurrent);
      if (lyrics) candidates.push({provider:'LRCLIB',trackId:track.uri,lyrics,timings:uniqueTimingCount(lyrics)});
    })().catch(error=>warnings.push(`LRCLIB: ${error.message}`)),
    (async () => {
      if (!IsProviderEnabled('Spicy')) return;
      const id = amllTrackIds(track.uri)[0];
      if (!id) return;
      const lyrics = await FetchSpicy(id, duration, isCurrent);
      if (lyrics) candidates.push({provider:'Spicy',trackId:id,lyrics,timings:uniqueTimingCount(lyrics)});
    })().catch(error=>warnings.push(`Spicy: ${error.message}`)),
  ];
  await Promise.all(jobs);
  if (!isCurrent()) throw new Error('Track changed during lyric lookup');
  const valid = candidates.filter(candidate => {
    try {
      const checked = validateLyrics(candidate.lyrics,duration);
      if (!checked) return false;
      candidate.lyrics = {...checked,...((candidate.lyrics as any).Attribution ? {Attribution:(candidate.lyrics as any).Attribution} : {})};
      return true;
    } catch { warnings.push(`${candidate.provider}: invalid lyric data`); return false; }
  }).sort(compareCandidates);
  // Multiple AMLL edition IDs are candidates internally; the picker exposes the
  // best usable result from each provider rather than duplicate provider names.
  const chosen = valid.filter((c,i)=>valid.findIndex(v=>v.provider===c.provider)===i);
  if (!chosen.length && warnings.length) throw new Error(warnings.join('; '));
  const summaries = chosen.map(c=>({Provider:c.provider,TrackId:c.trackId,UniqueTimings:c.timings,Type:c.lyrics.Type}));
  return chosen.map(c=>({...c.lyrics,Source:{Provider:c.provider,TrackId:c.trackId,UniqueTimings:c.timings,HasWordSync:hasWordTiming(c.lyrics),
    CacheKey:`${c.provider}-${c.trackId}-${lyricFingerprint(c.lyrics)}`,Candidates:summaries,Warnings:warnings}}));
}

// Compatibility for callers which only need the automatically selected result.
export async function FetchLyrics(...args: Parameters<typeof FetchLyricCandidates>) {
  return (await FetchLyricCandidates(...args))[0];
}
