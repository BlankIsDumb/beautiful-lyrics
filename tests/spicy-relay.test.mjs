import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createSpicyRelay} from '../scripts/spicy-relay.mjs';
const origin='https://xpui.app.spotify.com';
const path='/v1/lyrics/3Qk92ozKLvbNyFMwkjNPfO';
async function run(t,handler){
  const server=createSpicyRelay(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  return 'http://127.0.0.1:'+server.address().port;
}
test('relay permits Spotify preflight, strips origin/cookies, and preserves upstream quota status',async t=>{
  let calls=0;
  const base=await run(t,async(url,options)=>{
    calls++;assert.equal(url,'https://api.spicylyrics.org'+path);
    assert.deepEqual(options.headers,{Authorization:'Bearer sl_pk_fixture',Accept:'application/json'});
    assert.equal(options.redirect,'error');
    return Response.json({Status:429},{status:429,headers:{'Retry-After':'60'}});
  });
  for (const headers of [{}, {Origin:origin}]) {
    const health=await fetch(base+'/health',{headers});
    assert.equal(health.status,200);
    assert.equal((await health.json()).service,'beautiful-lyrics-spicy-relay');
    if (headers.Origin) assert.equal(health.headers.get('access-control-allow-origin'),origin);
  }
  assert.equal((await fetch(base+'/health',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal(calls,0);
  const preflight=await fetch(base+path,{method:'OPTIONS',headers:{Origin:origin}});
  assert.equal(preflight.status,204);assert.equal(calls,0);
  const r=await fetch(base+path,{headers:{Origin:origin,Authorization:'Bearer sl_pk_fixture',Cookie:'spotify=must-not-forward'}});
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
  assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(calls,1);
});
test('relay rejects foreign origins, arbitrary destinations, and invalid credentials before dispatch',async t=>{
  let calls=0;const base=await run(t,()=>{calls++;throw new Error('must not dispatch')});
  assert.equal((await fetch(base+path,{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/proxy?url=https://example.com',{headers:{Origin:origin}})).status,404);
  assert.equal((await fetch(base+path,{headers:{Origin:origin}})).status,401);
  // fetch normalizes Host on some Node versions; use raw HTTP for rebinding.
  const hostStatus=await new Promise((resolve,reject)=>http.get(base+path,{headers:{Origin:origin,Host:'example.com'}},res=>{res.resume();resolve(res.statusCode)}).on('error',reject));
  assert.equal(hostStatus,403);
  assert.equal(calls,0);
});
