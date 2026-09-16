// server.js
// High-performance static HTTP server for Arena Live Preview
// Listens on 0.0.0.0:8080 and 0.0.0.0:3000 simultaneously

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

function createStaticServer(rootDirs) {
  return http.createServer((req, res) => {
    // Enable CORS and open access for preview proxy
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    let pathname = decodeURIComponent(parsedUrl.pathname);
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }

    // Try finding the file in rootDirs in order
    let resolvedPath = null;
    for (const dir of rootDirs) {
      const candidate = path.normalize(path.join(dir, pathname));
      if (candidate.startsWith(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedPath = candidate;
        break;
      }
    }

    if (!resolvedPath) {
      // Fallback: if requesting a file inside ocean-sim from root
      for (const dir of rootDirs) {
        const candidate = path.normalize(path.join(dir, 'ocean-sim', pathname));
        if (candidate.startsWith(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          resolvedPath = candidate;
          break;
        }
      }
    }

    if (!resolvedPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const stat = fs.statSync(resolvedPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(resolvedPath);
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
      });
    } catch (err) {
      console.error('File read error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });
}

const roots = [
  __dirname,
  path.join(__dirname, 'ocean-sim')
];

// Start primary server on port 8080
const server8080 = createStaticServer(roots);
server8080.listen(8080, '0.0.0.0', () => {
  console.log('🌊 Ocean Simulation server listening on http://0.0.0.0:8080');
});

// Start secondary server on port 3000
const server3000 = createStaticServer(roots);
server3000.listen(3000, '0.0.0.0', () => {
  console.log('🌊 Ocean Simulation server listening on http://0.0.0.0:3000');
});

// Handle graceful termination
process.on('SIGTERM', () => {
  server8080.close();
  server3000.close();
  process.exit(0);
});
