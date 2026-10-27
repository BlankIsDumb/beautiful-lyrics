import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
const localBuild = '// BeautifulLyricsLocal version 5.1.0-local.6 full fixture';
const oldBuild = '// BeautifulLyricsLocal version 5.1.0-local.5 previous fixture';

// Execute the real installer against an isolated fake CLI, never the user's
// Spicetify installation. Child PowerShell owns all fake commands and paths.
const fakeCLI = `
function global:spicetify {
  $global:LASTEXITCODE=0
  $state=Get-Content -LiteralPath $env:JEL_TEST_CONFIG -Raw | ConvertFrom-Json
  $command=$args -join ' '
  Add-Content -LiteralPath $env:JEL_TEST_LOG -Value $command
  if ($command -eq '-c') { return $env:JEL_TEST_CONFIG }
  if ($command -eq 'path -e root') { return $env:JEL_TEST_EXTENSIONS }
  if ($args[0] -eq 'config') {
    $field=$args[1]
    if ($args.Count -eq 2) { return $state.$field }
    if ($env:JEL_TEST_FAIL -eq 'config') { Add-Content -LiteralPath $env:JEL_TEST_LOG -Value 'INJECTED config'; $global:LASTEXITCODE=1; return }
    $list=@($state.extensions -split '\\|' | Where-Object { $_ })
    $value=$args[2]
    if ($value.EndsWith('-')) { $list=@($list | Where-Object { $_ -ne $value.Substring(0,$value.Length-1) }) }
    elseif ($value -notin $list) { $list+= $value }
    $state.extensions=$list -join '|'
    if ($env:JEL_TEST_FAIL -eq 'preservation') { Add-Content -LiteralPath $env:JEL_TEST_LOG -Value 'INJECTED preservation'; $state.current_theme='wrong-theme' }
    $state | ConvertTo-Json | Set-Content -LiteralPath $env:JEL_TEST_CONFIG
    return
  }
  if ($env:JEL_TEST_FAIL -eq 'apply' -and -not (Test-Path -LiteralPath ($env:JEL_TEST_LOG+'.failed'))) {
    Set-Content -LiteralPath ($env:JEL_TEST_LOG+'.failed') -Value 'once'
    Add-Content -LiteralPath $env:JEL_TEST_LOG -Value 'INJECTED apply'
    $global:LASTEXITCODE=1
  }
}
& $env:JEL_TEST_INSTALLER
`;

async function fixture(t, { names = ['other.js', 'beautiful-lyrics-local.mjs'], fail = '', old = oldBuild, canonical, scheme = 'tuyu' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jel-install-'));
  // Resolve/verify before recursive cleanup; the target is this one test's
  // freshly created directory, never a user-supplied or broad computed path.
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('jel-install-'));
  t.after(() => rm(resolved, { recursive: true, force: true }));
  for (const name of ['scripts', 'dist', 'extensions']) await mkdir(path.join(directory, name));
  await copyFile('scripts/install.ps1', path.join(directory, 'scripts/install.ps1'));
  await writeFile(path.join(directory, 'dist/just-enough-lyrics.mjs'), localBuild);
  for (const name of names) await writeFile(path.join(directory, 'extensions', name), name.startsWith('beautiful-lyrics') ? old : '// unrelated');
  if (canonical !== undefined) await writeFile(path.join(directory, 'extensions/just-enough-lyrics.mjs'), canonical);
  const config = path.join(directory, 'config.json');
  const original = JSON.stringify({ extensions: names.join('|'), current_theme: 'Comfy', color_scheme: scheme });
  await writeFile(config, original);
  const log = path.join(directory, 'commands.txt');
  const run = () => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', fakeCLI], {
    timeout: 20000, windowsHide: true,
    // A pwsh parent can export its PS7 module path to Windows PowerShell 5.
    // Restore the child's own built-in modules rather than mocking hash cmdlets.
    env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
      JEL_TEST_CONFIG: config, JEL_TEST_LOG: log, JEL_TEST_EXTENSIONS: path.join(directory, 'extensions'),
      JEL_TEST_INSTALLER: path.join(directory, 'scripts/install.ps1'), JEL_TEST_FAIL: fail },
  });
  return { directory, config, log, original, run };
}

test('Windows installer migrates only local fork registration and repeat update uses refresh', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await f.run();
  const config = JSON.parse(await readFile(f.config, 'utf8'));
  assert.equal(config.extensions, 'other.js|just-enough-lyrics.mjs');
  assert.equal(config.current_theme, 'Comfy');
  assert.equal(config.color_scheme, 'tuyu');
  assert.equal(await readFile(path.join(f.directory, 'extensions/beautiful-lyrics-local.mjs'), 'utf8'), oldBuild);
  assert.equal(await readFile(path.join(f.directory, 'extensions/just-enough-lyrics.mjs'), 'utf8'), localBuild);
  assert.match(await readFile(f.log, 'utf8'), /apply -n/);
  await f.run();
  assert.match(await readFile(f.log, 'utf8'), /-e refresh -n/);
});

for (const fail of ['config', 'preservation', 'apply']) {
  test(`Windows installer restores files/config after ${fail} failure`, { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t, { fail, canonical: oldBuild });
    await assert.rejects(f.run(), /Installation failed/);
    assert.match(await readFile(f.log, 'utf8'), new RegExp(`INJECTED ${fail}`));
    assert.equal(await readFile(f.config, 'utf8'), f.original);
    assert.equal(await readFile(path.join(f.directory, 'extensions/just-enough-lyrics.mjs'), 'utf8'), oldBuild);
    assert.equal((await readdir(path.join(f.directory, 'extensions'))).some(name => name.endsWith('.tmp')), false);
    if (fail === 'apply') assert.equal((await readFile(f.log, 'utf8')).match(/apply -n/g)?.length, 2);
  });
}

test('Windows installer leaves upstream/foreign files registered and untouched', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { names: ['other.js', 'beautiful-lyrics.mjs'], old: '// upstream loader' });
  await assert.rejects(f.run(), /not a recognized local fork/);
  assert.equal(await readFile(f.config, 'utf8'), f.original);
  await assert.rejects(readFile(path.join(f.directory, 'extensions/just-enough-lyrics.mjs')), /ENOENT/);
});

test('first install failure removes new canonical file and preserves an empty color scheme', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { fail: 'apply', scheme: '' });
  await assert.rejects(f.run(), /Installation failed/);
  assert.match(await readFile(f.log, 'utf8'), /INJECTED apply/);
  assert.equal(await readFile(f.config, 'utf8'), f.original);
  await assert.rejects(readFile(path.join(f.directory, 'extensions/just-enough-lyrics.mjs')), /ENOENT/);
});
