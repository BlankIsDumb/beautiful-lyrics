import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Windows shells do not expand globs, and Node 20/24 differ in directory/glob
// handling. Pass explicit files so npm test behaves the same on either runtime.
const directory = new URL('../tests/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs'))
  .map(name => fileURLToPath(new URL(name, directory)));
// Browser files each own a Chromium process. Running all of them together on
// Windows can starve real-time grace checks and exceed browser cleanup deadlines.
// Serialize files so `npm test` exercises the same workload reproducibly.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
