import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const exec = promisify(execFile);

test('proxy CLI start/status/duplicate start/stop and stale ownership are safe', async t => {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(),'bl-proxy-test-'));
  const statePath = path.join(directory,`relay-${port}.json`);
  const cli = command => exec(process.execPath,['spicy-proxy.mjs',command,'--port',String(port),'--state-dir',directory],{timeout:15000,windowsHide:true});
  t.after(async () => { await cli('stop').catch(()=>{}); await rm(directory,{recursive:true,force:true}); });
  await assert.rejects(cli('status'), e => e.code === 1);
  assert.match((await cli('start')).stdout,/Started/);
  const saved = await readFile(statePath,'utf8');
  assert.match((await cli('status')).stdout,/managed by this CLI/);
  assert.match((await cli('start')).stdout,/Already running/);
  assert.equal(await readFile(statePath,'utf8'),saved);
  // A stale file must not authorize shutdown of a different relay instance.
  await writeFile(statePath,JSON.stringify({...JSON.parse(saved),instance:'stale'}));
  try {
    await assert.rejects(cli('stop'),/not managed/);
    assert.match((await cli('status')).stdout,/unmanaged/);
  } finally { await writeFile(statePath,saved); }
  const denied = await fetch(`http://127.0.0.1:${port}/control/stop`, {method:'POST',headers:{Origin:'https://xpui.app.spotify.com','X-Relay-Control':JSON.parse(saved).secret}});
  assert.equal(denied.status,403);
  assert.match((await cli('stop')).stdout,/Stopped/);
  assert.match((await cli('stop')).stdout,/Already stopped/);
  await assert.rejects(cli('status'),e=>e.code===1);
});
