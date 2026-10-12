// Tiny static file server for the game.
// Binds 0.0.0.0 so the sandbox preview proxy can reach it. No host/origin allowlisting,
// no X-Frame-Options, no CSP -> safe to embed in the Arena preview iframe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(root, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`SPINE RUNNER serving ${root}`);
  console.log(`  local:   http://localhost:${port}/`);
  console.log(`  preview: http://0.0.0.0:${port}/`);
});
