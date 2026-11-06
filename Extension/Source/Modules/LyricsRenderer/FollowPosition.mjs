// All inputs are neutral scroll-content CSS pixels, never animated glyph boxes.
export function readableViewport(height, anchor = 45, card = false) {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(anchor) || anchor < 0 || anchor > 100) return;
  // The Card mask starts at the inner scrollport and fades over 8px at each edge.
  const safeTop = Math.min(card ? 8 : 24, height / 2);
  const safeBottom = Math.min(card ? 8 : 64, Math.max(0, height - safeTop - 1));
  const usable = height - safeTop - safeBottom;
  if (usable < 1) return;
  return {safeTop, safeBottom, usable, anchor: safeTop + usable * anchor / 100};
}

export function fixedAnchorTarget(bounds, height, anchor, maximumScroll, card = false) {
  const viewport = readableViewport(height, anchor, card);
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

// Card follows the same middle-song anchor but reserves only readable song edges.
// Source context never shortens these physical bounds; hidden source rows remain.
export function naturalEdgeSpace(bounds, height, intrinsicExtent) {
  const viewport = readableViewport(height, 45, true);
  const valid = bounds.filter(b => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top);
  if (!viewport || !valid.length || !Number.isFinite(intrinsicExtent)) return;
  return {
    leading: Math.ceil(Math.max(0, viewport.safeTop - Math.min(...valid.map(b => b.top)))),
    trailing: Math.ceil(Math.max(0, viewport.safeBottom - (intrinsicExtent - Math.max(...valid.map(b => b.bottom))))),
  };
}
