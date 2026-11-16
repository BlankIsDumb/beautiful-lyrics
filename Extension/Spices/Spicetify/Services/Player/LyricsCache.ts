import { ClearCacheEntries, CountCacheEntries } from '../Cache.ts';

export const LyricsCacheScopes = ['All', 'Spotify', 'Musixmatch', 'AMLL', 'LRCLIB', 'Spicy'] as const;
export type LyricsCacheScope = typeof LyricsCacheScopes[number];
const providerStores = ['Spotify', 'Musixmatch', 'AMLL', 'LRCLIB', 'Spicy'].map(name => 'BeautifulLyricsLocal_' + name);
const allStores = [...providerStores, 'Player_TrackInformation', 'Transformed'];
const scopeStores = (scope: LyricsCacheScope) => scope === 'All' ? allStores : ['BeautifulLyricsLocal_' + scope];

export async function GetLyricsCacheCounts() {
  const counts = await CountCacheEntries(allStores);
  return Object.fromEntries(LyricsCacheScopes.map(scope => {
    const values = scopeStores(scope).map(name => counts[name]);
    return [scope, values.some(value => value === undefined) ? undefined : values.reduce<number>((sum, value) => sum + value!, 0)];
  })) as Record<LyricsCacheScope, number | undefined>;
}

export async function ClearLyricsCache(scope: LyricsCacheScope, reload: () => void) {
  const clearing = ClearCacheEntries(scopeStores(scope));
  let cooldownFailed = false;
  if (scope === 'All') {
    // Counts stay independent of provider initialization. Only the All action
    // needs this in-memory retry reset, before reloading the current song.
    const { ResetAmllCooldown } = await import('./LyricsProviders.ts');
    ResetAmllCooldown();
    // Explicit allowlist: neither provider credential is a cache entry.
    for (const provider of ['Spotify', 'Musixmatch', 'LRCLIB', 'Spicy']) {
      try { localStorage.removeItem('BeautifulLyricsLocal/' + provider + 'Cooldown'); }
      catch { cooldownFailed = true; }
    }
  }
  const result = await clearing;
  reload();
  return { ...result, failed: result.failed || cooldownFailed };
}
