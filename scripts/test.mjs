import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Windows shells do not expand globs, and Node 20/24 differ in directory/glob
// handling. Pass explicit files so npm test behaves the same on either runtime.
const directory = new URL('../tests/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs'))
  .map(name => fileURLToPath(new URL(name, directory)));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
