// Demand is event-driven (navigation/settings/song changes), never polled.
export function lyricsRequired(settings, pathname) {
  return settings.fetchMode !== 'required' || settings.sidebarEnabled ||
    pathname === '/BeautifulLyrics/Page' || pathname === '/BeautifulLyrics/Fullscreen';
}
