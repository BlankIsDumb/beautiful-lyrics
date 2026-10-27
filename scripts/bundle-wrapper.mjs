// All four artifacts carry the same complete bundle. Claim ownership before CSS
// or dynamic imports run: canonical/legacy module URLs may execute concurrently.
export function wrapBundle(source, css) {
  return `// Just Enough Lyrics: self-contained build (legacy filenames are aliases).
(async () => {
  const key = Symbol.for('JustEnoughLyrics/Runtime');
  if (globalThis[key]) return;
  const lease = {};
  globalThis[key] = lease;
  let style;
  lease.release = () => {
    style?.remove();
    if (globalThis[key] === lease) delete globalThis[key];
  };
  try {
    // A pre-migration local build has no shared guard. Retire its lifecycle before
    // starting JEL. Unrelated upstream extensions are left to the installer/user.
    const previous = globalThis.BeautifulLyricsLocal;
    if (previous && /^5\\.1\\.0-local\\.[0-5]$/.test(previous.version)
        && typeof previous.dispose === 'function') previous.dispose();
    style = document.createElement('style');
    style.id = 'just-enough-lyrics';
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
    ${source}
  } catch (error) {
    try { lease.cleanup?.(); }
    catch (cleanupError) { console.error('Just Enough Lyrics cleanup failed', cleanupError); }
    lease.release();
    console.error('Just Enough Lyrics failed to start', error);
    throw error;
  }
})();
`;
}
