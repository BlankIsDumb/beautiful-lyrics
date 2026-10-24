import test from "node:test";
import assert from "node:assert/strict";
import {
  convertLrc,
  convertLrclib,
  validateLyrics,
} from "../Extension/Spices/Spicetify/Services/Player/ProviderFormats.mjs";
test("LRC handles repeated timestamps, offsets and blank instrumental boundaries", () => {
  const l = convertLrc(
    "[offset:100]\n[00:01.00][00:05.00]hello\n[00:03.00]\n[00:07.00]end",
    9,
  );
  assert.deepEqual(
    l.Content.map((v) => [v.StartTime, v.EndTime]),
    [
      [1.1, 3.1],
      [5.1, 7.1],
      [7.1, 9],
    ],
  );
});
test("Lyricsfile retains explicit word intervals and overlapping lines", () => {
  const l = convertLrclib(
    {
      hasWordSync: true,
      lyricsfile: `version: '1.0'
lines:
 - text: Hello world
   start_ms: 1000
   end_ms: 4000
   words:
    - {text: 'Hello ', start_ms: 1000, end_ms: 1800}
    - {text: world, start_ms: 2200, end_ms: 4000}
 - {text: echo, start_ms: 2500, end_ms: 3000}
`,
    },
    5,
  );
  assert.equal(l.Type, "Syllable");
  assert.equal(l.Content[0].Lead.EndTime, 4);
  assert.equal(l.Content[0].Lead.Syllables[1].StartTime, 2.2);
  assert.equal(l.Content[1].Lead.StartTime, 2.5);
});
test("unsafe or unsupported Lyricsfile is rejected", () => {
  for (const lyricsfile of [
    "version: '2.0'\nlines: []",
    "version: '1.0'\nversion: '1.0'\nlines: []",
    "version: '1.0'\nlines: &a [*a]",
  ])
    assert.throws(() => convertLrclib({ hasWordSync: true, lyricsfile }, 5));
});
test("Spicy-compatible schema preserves backing/instantaneous intervals and rejects invalid timing", () => {
  const x = {
    Type: "Syllable",
    Content: [
      {
        Type: "Vocal",
        Lead: { Syllables: [{ Text: "a", StartTime: 1, EndTime: 3 }] },
        Background: [{ Syllables: [{ Text: "b", StartTime: 2, EndTime: 2 }] }],
      },
    ],
  };
  assert.equal(validateLyrics(x, 4).Content[0].Background[0].EndTime, 2);
  x.Content[0].Lead.Syllables[0].EndTime = 0;
  assert.throws(() => validateLyrics(x, 4));
});
