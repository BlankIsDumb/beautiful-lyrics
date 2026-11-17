import { ClearCacheEntries, ClearCacheItems, CountCacheEntries } from '../Cache.ts';

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

// Returns true when a cooldown key could not be removed.
function resetCooldowns(resetAmll: () => void) {
  resetAmll();
  let failed = false;
  // Explicit allowlist: neither provider credential is a cache entry.
  for (const provider of ['Spotify', 'Musixmatch', 'LRCLIB', 'Spicy']) {
    try { localStorage.removeItem('BeautifulLyricsLocal/' + provider + 'Cooldown'); }
    catch { failed = true; }
  }
  return failed;
}

export async function ClearLyricsCache(scope: LyricsCacheScope, reload: () => void) {
  const clearing = ClearCacheEntries(scopeStores(scope));
  let cooldownFailed = false;
  if (scope === 'All') {
    // Counts stay independent of provider initialization. Only the All action
    // needs this in-memory retry reset, before reloading the current song.
    const { ResetAmllCooldown } = await import('./LyricsProviders.ts');
    cooldownFailed = resetCooldowns(ResetAmllCooldown);
  }
  const result = await clearing;
  reload();
  return { ...result, failed: result.failed || cooldownFailed };
}

export async function ClearTrackLyricsCache(uri: string, canonical: string | undefined, reload: () => void): Promise<{ removed: number; failed: boolean }> {
  const { ResetAmllCooldown, amllTrackIds } = await import('./LyricsProviders.ts');
  const ids = amllTrackIds(uri, canonical);
  const spicy = amllTrackIds(uri)[0];
  // Keys match each provider's own cache key. Track details and prepared
  // lyrics stay; the provider caches are what a refetch must bypass.
  const keys: Record<string, readonly string[]> = {
    Spotify: ids,
    Musixmatch: /^spotify:track:[A-Za-z0-9]{22}$/.test(uri) ? [uri.split(':')[2]] : [],
    AMLL: ids,
    LRCLIB: [encodeURIComponent(uri)],
    Spicy: spicy ? [spicy] : [],
  };
  const clearing = ClearCacheItems(Object.entries(keys).map(([provider, items]) => ({ store: 'BeautifulLyricsLocal_' + provider, keys: items })));
  const cooldownFailed = resetCooldowns(ResetAmllCooldown);
  const result = await clearing;
  reload();
  return { removed: result.removed, failed: result.failed || cooldownFailed };
}
