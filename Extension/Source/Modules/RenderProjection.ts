import type { LyricDocument, LyricVoice } from "./LyricDocument.ts";
import { CreateDisplayRun, type DisplayRun } from "./TextLayout.ts";
import type { TextDetail } from "../RenderingSettings.ts";

export function ResolveDetail(document: LyricDocument, requested: TextDetail): "plain" | "line" | "word" {
  if (document.type === "Static") return "plain";
  if (document.precision === "line" || requested === "line") return "line";
  if (requested === "word") return document.precision === "word" ? "word" : "line";
  // Source precision is the case boundary. Whole-line Syllable wrappers never
  // gain word-only effects merely because an old saved preference says Auto.
  return document.type === "Syllable" ? "word" : "line";
}
export function JoinDisplayRuns(runs: readonly DisplayRun[]): string {
  let text = "";
  runs.forEach((run, index) => {
    text += run.Text;
    const next = runs[index + 1];
    if (next && !run.IsPartOfWord && !run.ExplicitSpacing && !/\s$/u.test(run.Text) && !/^\s/u.test(next.Text)) text += " ";
  });
  return text;
}
export function LineProjection(voice: LyricVoice, runs: readonly DisplayRun[]): DisplayRun {
  // Coarsening changes only the display unit, retaining all exact interval/range
  // references. It never invents finer word/phoneme timing for a line source.
  const line = CreateDisplayRun(JoinDisplayRuns(runs), runs.flatMap(run => run.SourceRanges), false);
  line.StartTime = voice.start; line.EndTime = voice.end;
  line.SafeLetters = false;
  line.Precision = "grouped";
  return line;
}
