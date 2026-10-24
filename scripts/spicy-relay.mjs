import http from 'node:http';
import { pathToFileURL } from 'node:url';

const spotifyOrigin = 'https://xpui.app.spotify.com';
const upstream = 'https://api.spicylyrics.org';

export function createSpicyRelay(fetchUpstream = fetch, control) {
  return http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify(body));
    };
    // Bind to loopback and reject DNS rebinding/foreign website requests. This
    // is deliberately not a general URL proxy and never persists credentials.
    const port = res.socket.localPort;
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(403,{error:'Invalid host'});
    if (req.url === '/health' && req.method === 'GET' && !req.headers.origin) return reply(200,{service:'beautiful-lyrics-spicy-relay',version:1,...(control ? {pid:process.pid,instance:control.instance} : {})});
    // CLI control is separate from API credentials and never enabled for browser
    // origins. No PID-based kill: only the process holding this secret can stop.
    if (req.url === '/control/stop' && req.method === 'POST') {
      if (!control || req.headers.origin || req.headers['x-relay-control'] !== control.secret) return reply(403,{error:'Control denied'});
      reply(200,{stopping:true});
      setImmediate(control.stop);
      return;
    }
    if (req.headers.origin !== spotifyOrigin) return reply(403,{error:'Origin not allowed'});
    res.setHeader('Access-Control-Allow-Origin',spotifyOrigin);
    res.setHeader('Vary','Origin');
    // Startup checks stay local and credential-free. Keep the same origin gate
    // as lyric requests; native launchers may also use the no-Origin path above.
    if (req.url === '/health' && req.method === 'GET') return reply(200,{service:'beautiful-lyrics-spicy-relay',version:1});
    if (!/^\/v1\/lyrics\/[A-Za-z0-9]{22}$/.test(req.url || '')) return reply(404,{error:'Unknown route'});
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization');
      res.setHeader('Access-Control-Allow-Private-Network','true');
      res.setHeader('Access-Control-Max-Age','600');
      res.writeHead(204);return res.end();
    }
    if (req.method !== 'GET') return reply(405,{error:'Method not allowed'});
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer sl_(?:pk|sk)_[A-Za-z0-9_-]+$/.test(authorization)) return reply(401,{error:'A Spicy API key is required'});
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),15000);
    res.on('close',()=>controller.abort());
    try {
      // Only the API token goes upstream. In particular, do not forward Origin,
      // Spotify cookies, Spotify tokens, or arbitrary caller-supplied headers.
      const response = await fetchUpstream(upstream + req.url,{
        headers:{Authorization:authorization,Accept:'application/json'},
        signal:controller.signal,redirect:'error',
      });
      const chunks=[];let size=0;
      for await (const chunk of response.body || []) {
        size += chunk.byteLength;
        if (size > 5_000_000) throw new Error('Response too large');
        chunks.push(Buffer.from(chunk));
      }
      const retry=response.headers.get('retry-after');
      if (retry) res.setHeader('Retry-After',retry);
      res.setHeader('Access-Control-Expose-Headers','Retry-After');
      res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(Buffer.concat(chunks));
    } catch {
      if (!res.destroyed) reply(502,{error:'Spicy request unavailable'});
    } finally { clearTimeout(timeout); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server=createSpicyRelay();
  server.on('error',error=>{console.error(`Spicy relay could not start (${error.code || 'error'}).`);process.exitCode=1;});
  server.listen(8967,'127.0.0.1',()=>console.log('Beautiful Lyrics Spicy relay listening on 127.0.0.1:8967.'));
}
