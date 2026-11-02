// Layout belongs to a viewer, independently of the source's Word/Line effects.
// Null spacing overrides preserve the surface's original responsive defaults.
export type LayoutProfile = {
  primaryRatio: number; backingRatio: number; leadWeight: number; backingWeight: number;
  leading: number; groupGap: number | null;
  before: number | null; after: number | null; follow: boolean;
  transition: "classic" | "instant" | "smooth"; anchor: number;
  resume: "classic" | "delay"; resumeDelay: number;
};
export const ClassicLayout: Readonly<LayoutProfile> = Object.freeze({
  primaryRatio: 1, backingRatio: .75, leadWeight: 700, backingWeight: 500,
  leading: 1.1818181818, groupGap: null, before: null, after: null,
  follow: true, transition: "classic", anchor: 45, resume: "classic", resumeDelay: .75,
});
export const LayoutCategories = {
  typography: ["primaryRatio", "backingRatio", "leadWeight", "backingWeight", "leading", "groupGap"],
  context: ["before", "after"], scrolling: ["follow", "transition", "anchor", "resume", "resumeDelay"],
} as const;
export type LayoutCategory = keyof typeof LayoutCategories;
export function NormalizeLayout(value?: Partial<LayoutProfile>): LayoutProfile {
  const result = { ...ClassicLayout };
  const bounded = (key: keyof LayoutProfile, minimum: number, maximum: number, nullable = false, integer = false) => {
    const item = value?.[key];
    if (nullable && item === null) (result as any)[key] = null;
    else if (typeof item === "number" && Number.isFinite(item) && item >= minimum && item <= maximum && (!integer || Number.isSafeInteger(item))) (result as any)[key] = item;
  };
  bounded("primaryRatio", .5, 2); bounded("backingRatio", .5, 1);
  bounded("leadWeight", 100, 900); bounded("backingWeight", 100, 900);
  if(result.leadWeight%100)result.leadWeight=ClassicLayout.leadWeight;
  if(result.backingWeight%100)result.backingWeight=ClassicLayout.backingWeight;
  bounded("leading", 1, 2.5); bounded("groupGap", 0, 2, true);
  bounded("before", 0, Number.MAX_SAFE_INTEGER, true, true); bounded("after", 0, Number.MAX_SAFE_INTEGER, true, true);
  bounded("anchor", 0, 100); bounded("resumeDelay", 0, 30);
  if (typeof value?.follow === "boolean") result.follow = value.follow;
  if (["classic", "instant", "smooth"].includes(value?.transition as string)) result.transition = value!.transition!;
  if (value?.resume === "classic" || value?.resume === "delay") result.resume = value.resume;
  return result;
}
export const LayoutFields = (previous: LayoutProfile, next: LayoutProfile) =>
  (Object.keys(next) as (keyof LayoutProfile)[]).filter(key => previous[key] !== next[key]);
export function NormalizeFontFamily(value: unknown): string {
  // A local CSS family list only. setProperty supplies the value, never markup.
  // Reject rule delimiters/control characters and CSS functions/URLs entirely.
  return typeof value === "string" && value.length <= 512 && !/[;{}()\\\x00-\x1f\x7f]/.test(value) ? value.trim() : "";
}

export function ApplyLayoutStyle(root: HTMLElement, layout: LayoutProfile, family: string) {
  const properties: Record<string, string | null> = {
    "--jel-primary-ratio": String(layout.primaryRatio), "--jel-backing-ratio": String(layout.backingRatio),
    "--jel-lead-weight": String(layout.leadWeight), "--jel-backing-weight": String(layout.backingWeight),
    "--jel-leading": String(layout.leading), "--jel-family": family || null,
    "--jel-group-gap": layout.groupGap === null ? null : String(layout.groupGap),
  };
  for (const [name, value] of Object.entries(properties)) {
    if (value === null) { if (root.style.getPropertyValue(name)) root.style.removeProperty(name); }
    else if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  // Root height changes during layout. A style-attribute substring selector
  // would invalidate every lyric descendant on those unrelated writes, even
  // with the family blank. Change this selector state only with family presence.
  if(root.classList.contains("CustomFontFamily") !== !!family) root.classList.toggle("CustomFontFamily", !!family);
  root.classList.toggle("CustomGroupGap", layout.groupGap !== null);
}
