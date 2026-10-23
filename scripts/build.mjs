import { build } from 'esbuild';
import * as sass from 'sass';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const styles = new Map();
const aliases = { '@Spices/': 'Extension/Spices/', '@Universal/': 'Universal/', '@Pinyin/': 'Pinyin/' };
const result = await build({
  absWorkingDir: root,
  entryPoints: ['Extension/Source/local.ts'],
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  minify: true, write: false, legalComments: 'eof',
  plugins: [{
    name: 'local-assets',
    setup(build) {
      build.onResolve({ filter: /^(npm:|jsr:@3d\/three$)/ }, args =>
        build.resolve(args.path === 'jsr:@3d/three' ? 'three' : args.path.slice(4).replace(/@[^/@]+$/, ''), {
          resolveDir: root, kind: args.kind,
        }));
      build.onResolve({ filter: /^@(Spices|Universal|Pinyin)\// }, args => {
        const prefix = Object.keys(aliases).find(key => args.path.startsWith(key));
        return { path: path.join(root, aliases[prefix], args.path.slice(prefix.length)) };
      });
      build.onResolve({ filter: /^local-dictionary$/ }, () => ({ path: 'dictionary', namespace: 'embedded' }));
      build.onLoad({ filter: /.*/, namespace: 'embedded' }, async () => {
        const directory = path.join(root, 'node_modules/kuromoji/dict');
        const dictionary = {};
        for (const name of (await readdir(directory)).sort()) {
          if (name.endsWith('.gz')) dictionary[name] = (await readFile(path.join(directory, name))).toString('base64');
        }
        // Keep the dictionary compressed until a Japanese track actually needs it.
        return { contents: `const data=${JSON.stringify(dictionary)}; export function readDictionary(name) {
          const encoded=data[name]; if (!encoded) throw new Error('Unknown bundled dictionary: '+name);
          return Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer;
        }`, loader: 'js' };
      });
      build.onLoad({ filter: /\.(scss|css)$/ }, async args => {
        const css = args.path.endsWith('.scss')
          ? (await sass.compileAsync(args.path, { style: 'compressed' })).css
          : await readFile(args.path, 'utf8');
        styles.set(args.path, css);
        return { contents: '', loader: 'js' };
      });
    }
  }]
});
// All style jobs finish inside onLoad, before build resolves. Do not snapshot a
// promise array while esbuild is still discovering imports (the old offline bug).
const css = [...styles].sort(([a], [b]) => a.localeCompare(b)).map(([, css]) => css).join('\n');
const styleCode = `const style=document.createElement('style');style.id='beautiful-lyrics-local';style.textContent=${JSON.stringify(css)};document.head.append(style);\n`;
const code = styleCode + result.outputFiles[0].text;
if (/socalifornian\.live/.test(code)) throw new Error('Local bundle still contains an author-hosted dependency');
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/beautiful-lyrics-local.mjs'), code);
console.log(`Built self-contained extension: ${(Buffer.byteLength(code) / 1024 / 1024).toFixed(1)} MiB, ${styles.size} stylesheets`);
