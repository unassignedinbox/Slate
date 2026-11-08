/**
 * Dependency-free static server for the production build.
 *
 *   node tools/serve.mjs [dist] [port]
 *
 * The Vite dev server is the nicer thing to develop against, but it puts a
 * host-check middleware, an HMR websocket and a client script between the
 * page and the browser. When a preview pane comes up blank those are three
 * variables that have to be ruled out one at a time. This serves the built
 * bundle over plain HTTP with none of them, so what the browser receives is
 * exactly what is on disk.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // keep the resolved path inside the served root
  const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback so a refresh on any path still boots the app
      fs.readFile(path.join(root, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': TYPES['.html'] }).end(html);
      });
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      // never let a proxy hand back a stale bundle
      'cache-control': 'no-store',
    }).end(buf);
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`serving ${root} on http://0.0.0.0:${port}`);
});
