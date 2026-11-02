// Spicetify loads extensions during startup. Wait only for the public host
// object; Session.ts handles its individual services after this point.
while (!(globalThis as any).Spicetify?.Platform) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
const runtimeLease = (globalThis as any)[Symbol.for('JustEnoughLyrics/Runtime')];
// Register cleanup before main imports views/providers: if partial startup throws,
// the bundle guard must retire those resources before another alias can retry.
const session = await import('@Spices/Spicetify/Services/Session.ts');
if (runtimeLease) runtimeLease.cleanup = () => session.GlobalMaid.Destroy();
const extension = await import('./main.ts');
await extension.Ready;
const player = await import('@Spices/Spicetify/Services/Player/mod.ts');
// A small lifecycle/status surface is useful for local installs and diagnostics.
// Never expose provider credentials here.
const api = {
  name: 'Just Enough Lyrics',
  version: '5.1.0-local.24',
  status: () => ({
    track: player.Song?.Uri,
    lyricsLoaded: player.HaveSongLyricsLoaded,
    syncType: player.SongLyrics?.Type,
    lyricError: player.SongLyricsError,
    source: player.SongLyrics?.Source,
  }),
  dispose: () => {
    extension.default.Destroy();
    runtimeLease?.release();
    if ((globalThis as any).JustEnoughLyrics === api) delete (globalThis as any).JustEnoughLyrics;
    if ((globalThis as any).BeautifulLyricsLocal === api) delete (globalThis as any).BeautifulLyricsLocal;
  },
};
// Keep existing local diagnostics usable without owning a second runtime.
(globalThis as any).JustEnoughLyrics = api;
(globalThis as any).BeautifulLyricsLocal = api;
