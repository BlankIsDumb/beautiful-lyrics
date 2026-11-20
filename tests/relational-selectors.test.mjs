import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// A playback mutation of any of these features inside :has() can join the
// host/theme's ancestor invalidation set and restyle the whole document.
const runtimeFeatures = /\.(?:Active|Sung|Animating|ContextExcluded|ContextMuted|BeautifulLyricsBackground|Loading\.(?:Full|Outline))(?![\w-])|\[\s*(?:aria-hidden|inert|style)(?![\w-])|:disabled(?![\w-])/i;

test('relational selectors exclude features that JEL changes during playback or interaction', () => {
  const root = 'Extension/Source';
  const violations = [];
  for (const file of readdirSync(root, { recursive: true }).filter(file => file.endsWith('.scss'))) {
    const source = readFileSync(path.join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
      .replace(/^[\t ]*\/\/.*$/gm, '');
    for (const match of source.matchAll(/:has\(/gi)) {
      const start = match.index + match[0].length;
      let end = start, depth = 1;
      // Keep nested :not() and :is() arguments in the inspected selector.
      for (; end < source.length && depth > 0; end++) {
        if (source[end] === '(') depth++;
        if (source[end] === ')') depth--;
      }
      assert.equal(depth, 0, `${file} has an unclosed :has()`);
      const selector = source.slice(start, end - 1);
      if (runtimeFeatures.test(selector)) violations.push(`${file}:${source.slice(0, start).split('\n').length} :has(${selector})`);
    }
  }
  assert.deepEqual(violations, []);
});
