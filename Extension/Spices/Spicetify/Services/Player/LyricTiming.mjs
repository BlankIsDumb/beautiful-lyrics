// Instantaneous events are legitimate in provider data. Avoid 0/0 in the
// animator without expanding them into fabricated sustained vocals.
export function timingProgress(time, start, duration) {
  return duration > 0 ? Math.max(0, Math.min(1, (time - start) / duration)) : (time >= start ? 1 : 0);
}

export function uniqueTimingCount(lyrics) {
  const times = new Set();
  for (const group of lyrics.Content || []) {
    if (group.Type !== 'Vocal') continue;
    const segments = group.Lead
      ? [group.Lead, ...(group.Background || [])].flatMap(v => v.Syllables)
      : [group];
    for (const segment of segments) {
      // Millisecond precision prevents floating point noise inflating the score.
      if (segment.Text?.trim()) times.add(Math.round(segment.StartTime * 1000));
    }
  }
  return times.size;
}

export function lyricFingerprint(lyrics) {
  let hash = 2166136261;
  for (const char of JSON.stringify(lyrics)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
