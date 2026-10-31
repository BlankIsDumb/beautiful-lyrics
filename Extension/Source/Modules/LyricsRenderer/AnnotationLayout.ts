export interface AnnotationLayoutJob {
  prepare(): void;
  measure(): void;
  reserve(): void;
  locate(): void;
  commit(): void;
  cleanup(): void;
}

// All voices cross each write/read barrier together. A width change must cause
// a fixed number of layouts, never one synchronous layout per reading/voice.
export function RunAnnotationLayout(jobs: AnnotationLayoutJob[]) {
  const active = new Set(jobs);
  try {
    for (const phase of ['prepare', 'measure', 'reserve', 'locate', 'commit'] as const) {
      for (const job of active) {
        try { job[phase](); }
        catch (error) { active.delete(job); job.cleanup(); console.warn('Reading layout omitted an unsafe projection', error); }
      }
    }
  } finally { for (const job of active) job.cleanup(); }
}
