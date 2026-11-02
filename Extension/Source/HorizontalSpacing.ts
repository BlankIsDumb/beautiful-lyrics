export const HorizontalSurfaces = ["Card", "Contained", "Fullscreen"] as const;
export type HorizontalSurface = typeof HorizontalSurfaces[number];
export function NormalizeHorizontalSpacing(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= -100 && value <= 100 ? value : 0;
}
export type HorizontalMetrics = {
  rootLeft: number; rootRight: number; defaultLeft: number; defaultRight: number;
  safeLeft: number; safeRight: number; primary: number; fontFraction: number; adjustment: number;
};
export function ResolveHorizontalSpacing(m: HorizontalMetrics) {
  if (!Object.values(m).every(Number.isFinite) || m.safeRight <= m.safeLeft || m.primary <= 0 || m.fontFraction <= 0) return;
  const left = Math.max(m.safeLeft, Math.min(m.safeRight, m.defaultLeft));
  const right = Math.max(left, Math.min(m.safeRight, m.defaultRight));
  const width = right - left;
  if (width <= 0) return;
  const minimum = Math.min(width, 4 * m.primary / m.fontFraction);
  const center = (left + right) / 2, r = NormalizeHorizontalSpacing(m.adjustment);
  const t = Math.abs(r) / 100;
  const targetLeft = r < 0 ? m.safeLeft : center - minimum / 2;
  const targetRight = r < 0 ? m.safeRight : center + minimum / 2;
  const resultLeft = left + (targetLeft - left) * t, resultRight = right + (targetRight - right) * t;
  return {left: resultLeft, right: resultRight, width: resultRight - resultLeft,
    leftGap: resultLeft - m.rootLeft, rightGap: m.rootRight - resultRight,
    limited: r < 0 ? Math.abs(width - (m.safeRight - m.safeLeft)) < .5 : r > 0 && Math.abs(width - minimum) < .5};
}


export type HorizontalMeasurement = Readonly<NonNullable<ReturnType<typeof ResolveHorizontalSpacing>>>;
// Effective readout pixels are metadata, not inherited CSS inputs. Publishing
// them as root custom properties needlessly restyles every timed descendant.
const measurements = new WeakMap<HTMLElement, HorizontalMeasurement>();
export const GetHorizontalMeasurement = (root: HTMLElement) => measurements.get(root);
export function SetHorizontalMeasurement(root: HTMLElement, value?: HorizontalMeasurement) {
  if(value)measurements.set(root,value);else measurements.delete(root);
}
