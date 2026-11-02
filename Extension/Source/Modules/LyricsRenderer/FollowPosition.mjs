// All inputs are neutral scroll-content CSS pixels, never animated glyph boxes.
export function readableViewport(height, anchor = 45) {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(anchor) || anchor < 0 || anchor > 100) return;
  const safeTop = Math.min(24, height / 2);
  const safeBottom = Math.min(64, Math.max(0, height - safeTop - 1));
  const usable = height - safeTop - safeBottom;
  if (usable < 1) return;
  return {safeTop, safeBottom, usable, anchor: safeTop + usable * anchor / 100};
}

export function fixedAnchorTarget(bounds, height, anchor, maximumScroll) {
  const viewport = readableViewport(height, anchor);
  if (!viewport || !Number.isFinite(maximumScroll) || maximumScroll < 0 || !bounds.length) return;
  const valid = bounds.filter(b => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top);
  if (!valid.length) return;
  const {safeTop, safeBottom, usable} = viewport;
  let top = Math.min(...valid.map(b => b.top)), bottom = Math.max(...valid.map(b => b.bottom));
  if (bottom - top > usable) {
    // Stable semantic ordering: a transform or a wrapping change cannot win a tie.
    const newest = valid.reduce((a,b) => b.start > a.start || b.start === a.start && ((b.group ?? 0) > (a.group ?? 0) || (b.group ?? 0) === (a.group ?? 0) && (b.voice ?? 0) > (a.voice ?? 0)) ? b : a);
    top = newest.top; bottom = newest.bottom;
  }
  const target = bottom - top > usable ? top - safeTop
    : Math.max(bottom - (height - safeBottom), Math.min(top - safeTop, (top + bottom) / 2 - viewport.anchor));
  return Math.max(0, Math.min(maximumScroll, target));
}

export function edgeSpace(bounds, height, anchor, intrinsicExtent) {
  const viewport = readableViewport(height, anchor);
  const valid = bounds.filter(b => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top);
  if (!viewport || !valid.length || !Number.isFinite(intrinsicExtent)) return;
  return {
    leading: Math.ceil(Math.max(0, viewport.anchor - Math.min(...valid.map(b => b.top)))),
    trailing: Math.ceil(Math.max(0, height - viewport.anchor - (intrinsicExtent - Math.max(...valid.map(b => b.bottom))))),
  };
}
