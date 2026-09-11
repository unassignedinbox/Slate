//==========================================================================================
// Static host — serves the studio plus the WGSL sources it imports. WebGPU requires a secure
// context, so localhost counts; opening index.html from the file system does not.
//
//   node tools/serve.mjs [port]
//==========================================================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wgsl': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.glb': 'model/gltf-binary',
    '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
    try
    {
        const url = new URL(request.url, `http://${request.headers.host}`);
        let target = decodeURIComponent(url.pathname);
        if (target === '/')
        {
            target = '/index.html';
        }
        const file = path.join(root, path.normalize(target).replace(/^(\.\.[/\\])+/, ''));
        if (!file.startsWith(root))
        {
            response.writeHead(403).end('forbidden');
            return;
        }
        const info = await stat(file);
        if (info.isDirectory())
        {
            response.writeHead(302, { location: `${target.replace(/\/$/, '')}/index.html` }).end();
            return;
        }
        const body = await readFile(file);
        response.writeHead(200, {
            'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            'cache-control': 'no-store',
            'cross-origin-opener-policy': 'same-origin',
            'cross-origin-embedder-policy': 'require-corp',
        });
        response.end(body);
    }
    catch (error)
    {
        response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${error.message}`);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Slate SDF Terrain Studio → http://localhost:${port}/`);
    console.log(`serving ${root}`);
});
