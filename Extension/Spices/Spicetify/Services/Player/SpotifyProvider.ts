import { Spotify } from '../Session.ts';
import { GetExpireStore } from '../Cache.ts';
import { convertSpotify } from './SpotifyLyrics.mjs';
import { IsCachedLyrics } from './CachedLyrics.ts';
import type { ProviderLyrics } from './LyricUtilities.ts';

const cache = GetExpireStore<ProviderLyrics | false>('BeautifulLyricsLocal_Spotify',1,{Duration:14,Unit:'Days'},true,IsCachedLyrics);
const cooldownKey = 'BeautifulLyricsLocal/SpotifyCooldown';
let queue: Promise<unknown> = Promise.resolve();
export const GetSpotifyCacheGeneration = () => cache.GetGeneration();
export function FetchSpotify(id: string, duration: number, isCurrent: () => boolean, generation = cache.GetGeneration()): Promise<ProviderLyrics | undefined> {
  const job = queue.catch(()=>{}).then(async () => {
    if (!/^[A-Za-z0-9]{22}$/.test(id) || !isCurrent()) return undefined;
    const cached = await cache.GetItem(id);
    if (cached !== undefined) return cached || undefined;
    if (Date.now() < Number(localStorage.getItem(cooldownKey)||0)) throw new Error('Spotify requests cooling down');
    if (!isCurrent()) throw new Error('Track changed before Spotify lookup');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let body;
    try {
      // Spotify's own authenticated transport; never export tokens to a proxy.
      body = await Promise.race([
        (Spotify as any).CosmosAsync.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),12000);}),
      ]);
    } catch (error) {
      const status = Number((error as any)?.status ?? (error as any)?.response?.status ?? (error as any)?.code);
      if (!isCurrent()) throw new Error('Track changed during Spotify lookup');
      if (status === 404) { await cache.SetItem(id,false,generation); return undefined; }
      // Native transport has no portable cancellation API. A timed-out result
      // is ignored, with cooldown preventing a pile-up of unresolved requests.
      localStorage.setItem(cooldownKey,String(Date.now()+([401,403,429].includes(status)?900000:60000)));
      throw new Error(Number.isFinite(status) ? `Spotify returned ${status}` : 'Spotify connection unavailable');
    } finally { clearTimeout(timer); }
    if (!isCurrent()) throw new Error('Track changed during Spotify lookup');
    const lyrics = convertSpotify(body,duration) as ProviderLyrics | undefined;
    // An empty/unsupported conversion is not an authoritative provider 404.
    if (lyrics) await cache.SetItem(id,lyrics,generation);
    return lyrics;
  });
  queue=job;
  return job;
}
