// serve.mjs — zero-dependency static server for the Slate SDF GI demo.
//   node server/serve.mjs [port]     (default 8080, binds 0.0.0.0 for the live preview)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = parseInt(process.argv[2] ?? "8080", 10);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".wgsl": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml",
};

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let p = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found: " + url); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => console.log(`Slate SDF GI → http://0.0.0.0:${PORT}/`));
