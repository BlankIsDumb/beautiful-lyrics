// Verify emitted string literals, not just source buffers: a valid JS bundle
// can still contain damaged dictionary data and fail only on a fresh CJK track.
export function verifyDictionary(code, expected) {
  const found = new Map();
  for (const match of code.matchAll(/"([^"\s]+\.gz)":("(?:[^"\\]|\\.)*")/g)) {
    if (Object.hasOwn(expected, match[1])) found.set(match[1], JSON.parse(match[2]));
  }
  for (const [name, encoded] of Object.entries(expected)) {
    if (found.get(name) !== encoded) throw new Error(`Bundled dictionary integrity failed: ${name}`);
  }
}
