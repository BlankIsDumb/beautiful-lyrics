// Bounds are measured at layout/active-state changes, never on each audio frame.
// Preserve the current viewport when possible; otherwise move only enough to
// reveal all active vocals. If their union cannot fit, prioritize the newer one.
export function overlapScrollTarget(bounds, viewportHeight, current, maximum) {
  if (!bounds.length || viewportHeight <= 0) return current;
  let top = Math.min(...bounds.map(b => b.top));
  let bottom = Math.max(...bounds.map(b => b.bottom));
  if (bottom - top > viewportHeight) {
    const newest = bounds.reduce((a, b) => b.start >= a.start ? b : a);
    top = newest.top;
    bottom = newest.bottom;
  }
  let target = current;
  if (bottom - top > viewportHeight || top < current) target = top;
  else if (bottom > current + viewportHeight) target = bottom - viewportHeight;
  return Math.max(0, Math.min(maximum, target));
}
