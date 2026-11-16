import { version } from "../../../../../package.json";
import { GetExpireStore, ClearCacheEntries } from "../Cache.ts";
import { IsCachedLyrics, IsCachedSpicyLyrics } from "./CachedLyrics.ts";
import {
  GetSpicyToken,
  OnProviderSettingsChanged,
} from "./ProviderSettings.ts";
import { convertLrclib, validateLyrics } from "./ProviderFormats.mjs";
import type { ProviderLyrics } from "./LyricUtilities.ts";
const lrcCache = GetExpireStore<ProviderLyrics | false>(
  "BeautifulLyricsLocal_LRCLIB",
  1,
  { Duration: 14, Unit: "Days" },
  true,
  IsCachedLyrics,
);
const client =
  `JustEnoughLyrics/${version} (https://github.com/BlankIsDumb/beautiful-lyrics)`;
let lrcQueue: Promise<unknown> = Promise.resolve();
let nextLrcAt = 0;
const spicyStoreName = "BeautifulLyricsLocal_Spicy";
// Reuse a played song for 14 days, well inside Spicy's 30-day limit. Reads do
// not extend the stored expiry; normal read cleanup/session pruning discards it.
const spicyCache = GetExpireStore<ProviderLyrics | false>(
  spicyStoreName, 1, { Duration: 14, Unit: "Days" }, true, IsCachedSpicyLyrics,
);
let spicyTokenClear: ReturnType<typeof ClearCacheEntries> | undefined;
let cachedToken = GetSpicyToken();
OnProviderSettingsChanged(() => {
  const token = GetSpicyToken();
  // Display/demand/provider switches do not change the credential owning these
  // results. Keep them when toggling sources; invalidate on rotation/removal.
  if (token !== cachedToken) {
    cachedToken = token;
    // ClearCacheEntries advances the store generation synchronously. Retain
    // its promise so a new credential cannot read old entries during deletion.
    spicyTokenClear = ClearCacheEntries([spicyStoreName]);
  }
});
const sanitizeSpicyAttribution = (attribution: NonNullable<ProviderLyrics['Attribution']>) => ({
  Source: String(attribution.Source),
  People: attribution.People.map(person => ({
    Name: String(person.Name),
    URL: typeof person.URL === 'string' && person.URL.startsWith('https://spicylyrics.org/') ? person.URL : undefined,
  })),
});
const cooldownKey = (name: string) => `BeautifulLyricsLocal/${name}Cooldown`;
async function jsonRequest(
  name: string,
  url: string,
  headers: Record<string, string>,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) throw new Error("Track changed before lyric lookup");
  if (Date.now() < Number(localStorage.getItem(cooldownKey(name)) || 0))
    throw new Error("Requests cooling down");
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error(name === 'Spicy' ? 'Local Spicy relay unavailable; start the relay using the launcher for your operating system' : 'Connection unavailable');
  } // Never expose credential-bearing transport errors.
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const seconds = retry ? Number(retry) : NaN;
    const until = Number.isFinite(seconds)
      ? Date.now() + seconds * 1000
      : retry
        ? Date.parse(retry)
        : NaN;
    if ([401, 403, 429, 503].includes(response.status))
      localStorage.setItem(
        cooldownKey(name),
        String(
          Math.max(
            Date.now() + 1000,
            Number.isFinite(until)
              ? until
              : Date.now() +
                  ([401, 403, 429].includes(response.status)
                    ? 900_000
                    : 60_000),
          ),
        ),
      );
    throw new Error(`Provider returned ${response.status}`);
  }
  return response.json();
}
export async function FetchLrclib(
  track: {
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
  },
  duration: number,
  isCurrent: () => boolean,
) {
  const generation = lrcCache.GetGeneration();
  const key = encodeURIComponent(track.uri);
  const cached = await lrcCache.GetItem(key);
  if (cached !== undefined) return cached || undefined;
  const job = lrcQueue
    .catch(() => {})
    .then(async () => {
      const again = await lrcCache.GetItem(key);
      if (again !== undefined) return again || undefined;
      const delay = nextLrcAt - Date.now();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (!isCurrent()) throw new Error("Track changed before lyric lookup");
      nextLrcAt = Date.now() + 500;
      const q = new URLSearchParams({
        track_name: track.name,
        artist_name: track.artists.map((a) => a.name).join(", "),
        album_name: track.album?.name || "",
        duration: String(duration),
      });
      const body = await jsonRequest(
        "LRCLIB",
        "https://lrclib.net/api/get?" + q,
        { "Lrclib-Client": client },
        isCurrent,
      );
      const lyrics = body ? convertLrclib(body, duration) : undefined;
      await lrcCache.SetItem(key, lyrics || false, generation);
      return lyrics as ProviderLyrics | undefined;
    });
  lrcQueue = job;
  return job;
}
export async function FetchSpicy(
  id: string,
  duration: number,
  isCurrent: () => boolean,
) {
  const generation = spicyCache.GetGeneration();
  const token = GetSpicyToken();
  if (!token) return undefined;
  const cleared = await spicyTokenClear;
  if (token !== GetSpicyToken() || generation !== spicyCache.GetGeneration())
    throw new Error("Provider settings or track changed");
  // A failed credential clear must not expose the previous token's cache in
  // this session. The provider can still fetch, and storage errors stay soft.
  const cached = cleared?.failed ? undefined : await spicyCache.GetItem(id);
  if (token !== GetSpicyToken()) throw new Error("Provider settings or track changed");
  if (cached !== undefined) {
    if (cached === false) return undefined;
    return { ...cached, Attribution: sanitizeSpicyAttribution(cached.Attribution!) };
  }
  const body = await jsonRequest(
    "Spicy",
    `http://127.0.0.1:8967/v1/lyrics/${id}`,
    { Authorization: `Bearer ${token}` },
    isCurrent,
  );
  if (token !== GetSpicyToken() || !isCurrent())
    throw new Error("Provider settings or track changed");
  if (body && body.Status !== 200)
    throw new Error(`Provider returned ${body.Status ?? "invalid response"}`);
  if (body === undefined) {
    // Only the relay's HTTP 404 is an authoritative not-found response.
    await spicyCache.SetItem(id, false, generation);
    return undefined;
  }
  const lyrics = body
    ? (validateLyrics(body.Body, duration) as ProviderLyrics | undefined)
    : undefined;
  if (lyrics) {
    const attribution = body.Body.UploadAttribution;
    const people = [attribution?.Uploader, attribution?.Maker]
      .filter(Boolean)
      .map((p) => ({
        Name: String(p.username || "Contributor"),
        URL:
          typeof p.url === "string" &&
          p.url.startsWith("https://spicylyrics.org/")
            ? p.url
            : undefined,
      }));
    lyrics.Attribution = sanitizeSpicyAttribution({
      Source: String(body.Body.source || "unknown"),
      People: people,
    });
    await spicyCache.SetItem(id, lyrics, generation);
  }
  return lyrics;
}
