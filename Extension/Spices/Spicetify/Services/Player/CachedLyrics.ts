import { validateLyrics } from './ProviderFormats.mjs';

// Validate cache content as well as its envelope. A stale/malformed payload
// must become a miss before it can suppress a fresh provider lookup.
export function IsCachedLyrics(content: unknown): boolean {
  if (content === false) return true;
  try { return !!validateLyrics(content, Infinity); }
  catch { return false; }
}

export function IsCachedSpicyLyrics(content: unknown): boolean {
  if (content === false) return true;
  if (!IsCachedLyrics(content)) return false;
  // Spicy persists the renderer's credits alongside its normalized lyrics.
  // Reject broken shapes before a cache hit can bypass the provider lookup;
  // string URLs are filtered again on read, including legacy/unsafe links.
  const attribution = (content as any).Attribution;
  return !!attribution && typeof attribution.Source === 'string'
    && Array.isArray(attribution.People) && attribution.People.every((person: any) =>
      !!person && typeof person.Name === 'string'
      && (person.Role === undefined || typeof person.Role === 'string')
      && (person.URL === undefined || typeof person.URL === 'string'));
}
