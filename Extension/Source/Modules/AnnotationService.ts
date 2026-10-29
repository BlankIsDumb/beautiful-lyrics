import type { LyricDocument, LyricVoice } from "./LyricDocument.ts";
import { AnnotationFingerprint, LayoutVoice, type DisplayRun } from "./TextLayout.ts";

export type AnnotationLanguage = "Chinese" | "Japanese" | "Korean";
export type AnnotationOptions = Readonly<{ languages: readonly AnnotationLanguage[]; japaneseForm: "romaji" | "kana" }>;
export type AnnotationResult = ReadonlyMap<string, readonly DisplayRun[]>;
export type VoiceConverter = (voice: LyricVoice, language: AnnotationLanguage, options: AnnotationOptions, signal: AbortSignal) => Promise<readonly DisplayRun[]>;
const converterVersion = "source-ranges-3-conversions-v2";
export const VoiceLanguage = (voice: LyricVoice, primary?: string): AnnotationLanguage | undefined => {
  const text = voice.spans.map(span => span.Text).join("");
  if (/[ぁ-んァ-ン]/u.test(text) || (primary === "jpn" && /\p{Script=Han}/u.test(text))) return "Japanese";
  if (/\p{Script=Hangul}/u.test(text)) return "Korean";
  if (/\p{Script=Han}/u.test(text)) return "Chinese";
};

export function CreateAnnotationService(convert: VoiceConverter, maximumResults = 8) {
  type Job = { controller: AbortController; leases: number; promise: Promise<AnnotationResult> };
  const jobs = new Map<string, Job>();
  const results = new Map<string, AnnotationResult>();
  return {
    acquire(document: LyricDocument, options: AnnotationOptions, primary?: string) {
      // A master/language Off never acquires work. The renderer also avoids this
      // call entirely when it has no effective language capability.
      const available = new Set(document.groups.flatMap(group => group.voices.map(voice => VoiceLanguage(voice, primary))));
      const languages = [...new Set(options.languages)].filter(language => available.has(language)).sort();
      const key = JSON.stringify([document.id, AnnotationFingerprint(document), primary, languages,
        languages.includes("Japanese") ? options.japaneseForm : "romaji", converterVersion]);
      const cached = results.get(key);
      if (cached) {
        results.delete(key); results.set(key, cached);
        return { promise: Promise.resolve(cached), release() {} };
      }
      let job = jobs.get(key);
      if (!job || job.controller.signal.aborted) {
        const controller = new AbortController();
        const created: Job = { controller, leases: 0, promise: undefined! };
        // A microtask lets an immediately disposed consumer cancel before any
        // converter initialization. Synchronous tokenization cannot be preempted;
        // check cooperatively before/after awaits and every queued voice.
        created.promise = Promise.resolve().then(async () => {
          const result = new Map<string, readonly DisplayRun[]>();
          let failed = false;
          for (const group of document.groups) for (const voice of group.voices) {
            if (controller.signal.aborted) return result;
            const language = VoiceLanguage(voice, primary);
            if (!language || !languages.includes(language)) continue;
            try {
              const runs = await convert(voice, language, options, controller.signal);
              if (controller.signal.aborted) return result;
              result.set(voice.id, runs);
            } catch {
              // Conversion/alignment failure never rejects the original source.
              if (controller.signal.aborted) return result;
              failed = true;
              result.set(voice.id, LayoutVoice(voice));
            }
          }
          if (!failed && !controller.signal.aborted && maximumResults > 0) {
            results.set(key, result);
            while (results.size > maximumResults) results.delete(results.keys().next().value!);
          }
          return result;
        }).finally(() => {
          // A cancelled job may have been replaced under this same key already.
          if (jobs.get(key) === created) jobs.delete(key);
        });
        job = created;
        jobs.set(key, job);
      }
      job.leases++;
      const leasedJob = job;
      let released = false;
      return {
        promise: job.promise,
        release() {
          if (released) return;
          released = true;
          if (--leasedJob.leases === 0) leasedJob.controller.abort();
        },
      };
    },
  };
}

// Dynamic import keeps converter/tokenizer module initialization behind actual
// view demand. Original-only documents never initialize these language tools.
export const AnnotationService = CreateAnnotationService(async (...args) => {
  const converters = await import("./AnnotationConverters.ts");
  if (args[3].aborted) return [];
  return converters.ConvertVoice(...args);
});
