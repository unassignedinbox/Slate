// Static server for the Road Editor.
//
//   node tools/serve.mjs [port]
//
// Two entry points, because they are for two different people:
//   /       the single-file build (dist/ProjectZeroEditor.html) — self-contained, so it also works
//           in a sandboxed iframe and from a file:// URL.
//   /dev    the module version (index.html) — what you want while editing src/*.js, since every
//           reload picks up the change without a rebuild.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.obj': 'text/plain; charset=utf-8',
};

const routes = {
  '/': 'dist/ProjectZeroEditor.html',
  '/dev': 'index.html',
  '/dev/': 'index.html',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = routes[url.pathname] || url.pathname.replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) throw new Error('directory');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    await new Promise((done, fail) => {
      const stream = fs.createReadStream(file);
      stream.on('error', fail);
      stream.on('close', done);
      stream.pipe(res);
    });
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${rel}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Road Editor serving ${root}`);
  console.log(`  http://0.0.0.0:${port}/      single-file build (dist/ProjectZeroEditor.html)`);
  console.log(`  http://0.0.0.0:${port}/dev   module build (index.html — edit src/ and reload)`);
});
