export function convertSpotify(body, duration) {
  const lyrics = body?.lyrics;
  if (!lyrics) return undefined;
  if (!Array.isArray(lyrics.lines) || lyrics.lines.length > 5000) throw new Error('Invalid Spotify lyrics');
  const rows = lyrics.lines.map(line => {
    if (typeof line.words !== 'string') throw new Error('Invalid Spotify lyric text');
    return {Text:line.words, rawTime:line.startTimeMs};
  });
  if (lyrics.syncType === 'UNSYNCED') {
    const Lines = rows.filter(row=>row.Text.trim()).map(({Text})=>({Text}));
    return Lines.length ? {Type:'Static',Lines} : undefined;
  }
  if (lyrics.syncType !== 'LINE_SYNCED') throw new Error('Unsupported Spotify sync type');
  let previous = -Infinity;
  const timed = rows.map(row => {
    if (row.rawTime === '' || row.rawTime == null) throw new Error('Invalid Spotify timing');
    const StartTime = Number(row.rawTime)/1000;
    if (!Number.isFinite(StartTime) || StartTime < 0 || StartTime > duration+5 || StartTime < previous) throw new Error('Invalid Spotify timing');
    previous = StartTime;
    return {Text:row.Text,StartTime};
  });
  // Spotify's sampled endTimeMs values are zero. Infer display boundaries from
  // the next event, including blank/instrumental markers; never invent word sync.
  const Content = timed.map((row,i)=>({Type:'Vocal',...row,EndTime:timed[i+1]?.StartTime ?? Math.max(duration,row.StartTime),OppositeAligned:false})).filter(row=>row.Text.trim());
  return Content.length ? {Type:'Line',StartTime:Content[0].StartTime,EndTime:Content.at(-1).EndTime,Content} : undefined;
}
