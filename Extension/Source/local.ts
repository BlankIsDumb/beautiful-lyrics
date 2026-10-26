// Spicetify loads extensions during startup. Wait only for the public host
// object; Session.ts handles its individual services after this point.
while (!(globalThis as any).Spicetify?.Platform) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
const extension = await import('./main.ts');
const player = await import('@Spices/Spicetify/Services/Player/mod.ts');
// A small lifecycle/status surface is useful for local installs and diagnostics.
// Never expose provider credentials here.
(globalThis as any).BeautifulLyricsLocal = {
  version: '5.1.0-local.5',
  status: () => ({
    track: player.Song?.Uri,
    lyricsLoaded: player.HaveSongLyricsLoaded,
    syncType: player.SongLyrics?.Type,
    lyricError: player.SongLyricsError,
    source: player.SongLyrics?.Source,
  }),
  dispose: () => {
    extension.default.Destroy();
    document.getElementById('beautiful-lyrics-local')?.remove();
    delete (globalThis as any).BeautifulLyricsLocal;
  },
};
