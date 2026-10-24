import { parseDocument } from "yaml";

// Validate at the provider boundary so bad timing cannot poison another source.
export function validateLyrics(input, duration) {
  if (!input || typeof input !== "object") return undefined;
  const text = (value) => {
    if (typeof value !== "string") throw new Error("Invalid lyric text");
    return value;
  };
  const interval = (start, end) => {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      end > duration + 5
    )
      throw new Error("Invalid lyric timing");
    return { StartTime: start, EndTime: end };
  };
  if (input.Type === "Static") {
    const Lines = (input.Lines || [])
      .map((l) => ({ Text: text(l.Text) }))
      .filter((l) => l.Text.trim());
    return Lines.length ? { Type: "Static", Lines } : undefined;
  }
  if (
    !["Line", "Syllable"].includes(input.Type) ||
    !Array.isArray(input.Content) ||
    input.Content.length > 5000
  )
    throw new Error("Invalid lyric format");
  let segmentCount = 0;
  const vocal = (v) => {
    if (!Array.isArray(v?.Syllables)) throw new Error("Invalid syllables");
    const Syllables = v.Syllables.map((s) => {
      if (++segmentCount > 30000) throw new Error("Too many lyric segments");
      return {
        Text: text(s.Text),
        ...interval(s.StartTime, s.EndTime),
        IsPartOfWord: !!s.IsPartOfWord,
      };
    }).filter((s) => s.Text.trim());
    if (!Syllables.length) throw new Error("Empty vocal");
    return {
      StartTime: Math.min(...Syllables.map((s) => s.StartTime)),
      EndTime: Math.max(...Syllables.map((s) => s.EndTime)),
      Syllables,
    };
  };
  const Content = input.Content.filter((l) => l.Type === "Vocal").map((l) =>
    input.Type === "Line"
      ? {
          Type: "Vocal",
          Text: text(l.Text),
          ...interval(l.StartTime, l.EndTime),
          OppositeAligned: !!l.OppositeAligned,
        }
      : {
          Type: "Vocal",
          Lead: vocal(l.Lead),
          ...(l.Background?.length
            ? { Background: l.Background.map(vocal) }
            : {}),
          OppositeAligned: !!l.OppositeAligned,
        },
  );
  if (!Content.length) return undefined;
  const all = Content.flatMap((l) =>
    l.Lead ? [l.Lead, ...(l.Background || [])] : [l],
  );
  return {
    Type: input.Type,
    StartTime: Math.min(...all.map((l) => l.StartTime)),
    EndTime: Math.max(...all.map((l) => l.EndTime)),
    Content,
  };
}

export function convertLrc(source, duration) {
  if (typeof source !== "string") return undefined;
  const offset =
    Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const Text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps)
      rows.push({
        Text,
        StartTime: Math.max(
          0,
          Number(stamp[1]) * 60 + Number(stamp[2]) + offset,
        ),
      });
  }
  rows.sort((a, b) => a.StartTime - b.StartTime);
  const Content = rows
    .map((l, i) => ({
      ...l,
      Type: "Vocal",
      EndTime:
        rows.slice(i + 1).find((n) => n.StartTime > l.StartTime)?.StartTime ??
        duration,
      OppositeAligned: false,
    }))
    .filter((l) => l.Text);
  return Content.length
    ? validateLyrics({ Type: "Line", Content }, duration)
    : undefined;
}

export function convertLrclib(record, duration) {
  if (record?.instrumental) return undefined;
  // Lyricsfile is the only field that preserves LRCLIB's word boundaries.
  if (record?.hasWordSync && typeof record.lyricsfile === "string") {
    if (record.lyricsfile.length > 2_000_000)
      throw new Error("Lyricsfile too large");
    const doc = parseDocument(record.lyricsfile, {
      uniqueKeys: true,
      schema: "core",
    });
    if (doc.errors.length) throw new Error("Invalid Lyricsfile YAML");
    const file = doc.toJS({ maxAliasCount: 0 });
    if (
      file?.version !== "1.0" ||
      !Array.isArray(file.lines) ||
      file.lines.length > 5000
    )
      throw new Error("Unsupported Lyricsfile");
    const rows = [...file.lines].sort((a, b) => a.start_ms - b.start_ms);
    const Content = rows.map((l, i) => {
      const end =
        l.end_ms ??
        rows.slice(i + 1).find((n) => n.start_ms > l.start_ms)?.start_ms ??
        duration * 1000;
      const words = l.words?.length
        ? l.words
        : [{ text: l.text, start_ms: l.start_ms, end_ms: end }];
      const Syllables = words.map((w, j) => ({
        Text: w.text,
        StartTime: w.start_ms / 1000,
        EndTime: (w.end_ms ?? words[j + 1]?.start_ms ?? end) / 1000,
        IsPartOfWord:
          j < words.length - 1 &&
          !/\s$/.test(w.text) &&
          !/^\s/.test(words[j + 1].text),
      }));
      return { Type: "Vocal", Lead: { Syllables }, OppositeAligned: false };
    });
    return validateLyrics({ Type: "Syllable", Content }, duration);
  }
  return (
    convertLrc(record?.syncedLyrics, duration) ||
    (typeof record?.plainLyrics === "string"
      ? validateLyrics(
          {
            Type: "Static",
            Lines: record.plainLyrics.split(/\r?\n/).map((Text) => ({ Text })),
          },
          duration,
        )
      : undefined)
  );
}

const priority = { Musixmatch: 0, Spicy: 1, AMLL: 2, LRCLIB: 3 };
export function hasWordTiming(lyrics) {
  // Some catalogs wrap entire lines in a Syllable object. That is still line
  // precision; keep its rendering shape without advertising invented word sync.
  return (
    lyrics.Type === "Syllable" &&
    lyrics.Content.some((line) =>
      [line.Lead, ...(line.Background || [])].some(
        (vocal) => new Set(vocal.Syllables.map((s) => s.StartTime)).size > 1,
      ),
    )
  );
}
export function compareCandidates(a, b) {
  const aWord = hasWordTiming(a.lyrics),
    bWord = hasWordTiming(b.lyrics);
  const aRank = aWord ? 2 : a.lyrics.Type === "Static" ? 0 : 1;
  const bRank = bWord ? 2 : b.lyrics.Type === "Static" ? 0 : 1;
  return (
    bRank - aRank ||
    (aWord ? b.timings - a.timings : 0) ||
    (a.provider !== b.provider && aWord && a.provider === "AMLL"
      ? -1
      : a.provider !== b.provider && aWord && b.provider === "AMLL"
        ? 1
        : 0) ||
    (priority[a.provider] ?? 9) - (priority[b.provider] ?? 9) ||
    a.trackId.localeCompare(b.trackId)
  );
}
