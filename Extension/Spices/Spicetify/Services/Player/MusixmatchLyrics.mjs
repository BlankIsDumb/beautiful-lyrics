// Pure conversion: keep the provider's real segment offsets. Never manufacture
// word timing by dividing line duration or splitting Japanese text into characters.
export function convertRichsync(lines) {
  if (!Array.isArray(lines) || !lines.length) return undefined;
  const content = lines.map(line => {
    // Some catalog entries have instantaneous whole lines, not just words.
    // Preserve equal endpoints for the renderer; only backwards time is invalid.
    if (!Number.isFinite(line.ts) || !Number.isFinite(line.te) || line.te < line.ts || !Array.isArray(line.l)) {
      throw new Error('Invalid Musixmatch richsync timing');
    }
    const syllables = [];
    for (let i = 0; i < line.l.length; i++) {
      const word = line.l[i];
      // Blank separators can be slightly out of order (observed: 1 ms). They
      // carry no vocals. Validate visible segments, not the separator interval.
      if (typeof word.c !== 'string') throw new Error('Invalid Musixmatch text');
      if (!word.c.trim()) continue;
      const next = line.l[i + 1];
      const start = line.ts + word.o;
      // Keep real pauses, but ignore separators that precede this segment.
      // Equal offsets remain instantaneous; never invent a duration or discard
      // a simultaneous word. Separate overlapping lines retain their own times.
      const boundary = line.l.slice(i + 1).find(entry => entry.c.trim() || line.ts + entry.o >= start);
      const end = boundary ? line.ts + boundary.o : line.te;
      if (typeof word.c !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start < line.ts || end < start || end > line.te + 0.001) {
        throw new Error('Invalid Musixmatch richsync segment');
      }
      syllables.push({
        Text: word.c.trim(), StartTime: start, EndTime: end,
        // The renderer inserts spaces between words, but joins adjacent chunks.
        IsPartOfWord: !!next && !/\s$/.test(word.c) && !/^\s/.test(next.c),
      });
    }
    if (!syllables.length) return undefined;
    return { Type: 'Vocal', OppositeAligned: false,
      Lead: { StartTime: syllables[0].StartTime, EndTime: syllables.at(-1).EndTime, Syllables: syllables } };
  }).filter(Boolean);
  if (!content.length) return undefined;
  content.sort((a, b) => a.Lead.StartTime - b.Lead.StartTime);
  return { Type: 'Syllable', StartTime: content[0].Lead.StartTime,
    EndTime: Math.max(...content.map(line => line.Lead.EndTime)), Content: content };
}

export function convertSubtitles(lines, duration) {
  if (!Array.isArray(lines)) return undefined;
  const content = lines.flatMap((line, i) => {
    if (typeof line.text !== 'string' || !line.text.trim() || line.text.trim() === '♪') return [];
    const start = line.time?.total;
    const end = lines[i + 1]?.time?.total ?? duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ Type: 'Vocal', Text: line.text, StartTime: start, EndTime: end, OppositeAligned: false }];
  });
  return content.length ? { Type: 'Line', StartTime: content[0].StartTime, EndTime: content.at(-1).EndTime, Content: content } : undefined;
}
