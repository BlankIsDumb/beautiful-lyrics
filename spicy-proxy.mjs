#!/usr/bin/env node
// Cross-platform lifecycle manager. API keys remain in Spotify, never here.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpicyRelay } from './scripts/spicy-relay.mjs';

const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const command = args.shift() || 'help';
let port = 8967;
let directory = path.join(path.dirname(self), 'local-backups', 'spicy-proxy');
while (args.length) {
  const flag = args.shift(), value = args.shift();
  if (flag === '--port' && value && /^\d+$/.test(value)) port = Number(value);
  else if (flag === '--state-dir' && value) directory = path.resolve(value);
  else { console.error('Unknown or incomplete option. Use: node spicy-proxy.mjs help'); process.exit(2); }
}
if (port < 1 || port > 65535 || Number(process.versions.node.split('.')[0]) < 20) {
  console.error('Requires Node.js 20+ and a port from 1 to 65535.'); process.exit(2);
}
const statePath = path.join(directory, `relay-${port}.json`);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function health() {
  try {
    const response = await fetch(base + '/health', {signal:AbortSignal.timeout(1000)});
    if (!response.ok) return {foreign:true};
    const result = await response.json();
    return result.service === 'beautiful-lyrics-spicy-relay' ? result : {foreign:true};
  } catch { return undefined; }
}
async function state() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return undefined; }
}
function managed(info, saved) {
  return !!info?.instance && info.instance === saved?.instance;
}
async function serve() {
  const instance = randomUUID(), secret = randomBytes(32).toString('hex');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    // A replacement process must never lose its state file to this cleanup.
    if ((await state())?.instance === instance) await unlink(statePath).catch(() => {});
  };
  const server = createSpicyRelay(fetch, {instance, secret, stop});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  try {
    await mkdir(directory, {recursive:true, mode:0o700});
    // Written only after owning the port; concurrent starts cannot overwrite it.
    await writeFile(statePath, JSON.stringify({pid:process.pid,instance,secret}), {mode:0o600});
  } catch (error) { await stop(); throw error; }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`Spicy proxy listening at ${base} (PID ${process.pid}).`);
}
async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage: node spicy-proxy.mjs start|stop|status|run [--port 8967] [--state-dir PATH]\nstart: detached background process; run: foreground (Ctrl+C to stop).\nDefault port 8967 is required by Beautiful Lyrics. No login tasks are installed.');
    return;
  }
  if (command === 'run') return serve();
  if (!['start','stop','status'].includes(command)) throw new Error('Unknown command; use help.');
  const info = await health(), saved = await state();
  if (command === 'status') {
    if (!info) { console.log(`Stopped or unreachable at ${base}.`); process.exitCode=1; }
    else if (info.foreign) { console.log(`Port ${port} is occupied by another service.`); process.exitCode=2; }
    else console.log(`Running at ${base}${info.pid ? ` (PID ${info.pid})` : ''}; ${managed(info,saved) ? 'managed by this CLI' : 'legacy/unmanaged relay'}.`);
    return;
  }
  if (command === 'stop') {
    if (!info) { console.log('Already stopped or unreachable. No process was killed.'); return; }
    if (!managed(info,saved)) throw new Error('Relay is not managed by this state directory; stop its original launcher/process manually.');
    const response = await fetch(base + '/control/stop', {method:'POST', headers:{'X-Relay-Control':saved.secret}, signal:AbortSignal.timeout(2000)});
    if (!response.ok) throw new Error('Relay refused the stop request.');
    for (let i=0;i<30;i++) {
      await sleep(100);
      const current = await health();
      if (!current || current.instance !== info.instance) { console.log('Stopped.'); return; }
    }
    throw new Error('Stop requested, but shutdown has not completed.');
  }
  if (info) {
    if (info.foreign) throw new Error(`Port ${port} is occupied by another service.`);
    console.log(`Already running at ${base}${managed(info,saved) ? '' : ' (legacy/unmanaged)'}.`);
    return;
  }
  await mkdir(directory, {recursive:true,mode:0o700});
  const logPath = path.join(directory, `relay-${port}.log`);
  const log = await open(logPath, 'a', 0o600);
  let spawnError;
  const child = spawn(process.execPath, [self,'run','--port',String(port),'--state-dir',directory], {
    detached:true, windowsHide:true, stdio:['ignore',log.fd,log.fd],
  });
  child.on('error', error => { spawnError = error; });
  child.unref();
  await log.close();
  for (let i=0;i<40;i++) {
    if (spawnError) throw spawnError;
    await sleep(100);
    const current = await health();
    if (managed(current,await state())) { console.log(`Started at ${base} (PID ${current.pid}).\nLog: ${logPath}`); return; }
  }
  throw new Error(`Startup failed or timed out. See ${logPath}`);
}
main().catch(error => { console.error(`Spicy proxy: ${error.message}`); process.exitCode=1; });
