// Static file server for the eagle showcase (no build step; ES modules straight from disk).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

createServer(async (request, response) =>
{
    const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
    const file = join(root, normalize(path === "/" ? "/index.html" : path));
    try
    {
        const body = await readFile(file);
        response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
        response.end(body);
    }
    catch { response.writeHead(404).end("not found"); }
}).listen(8080, "0.0.0.0", () => console.log("eagle showcase on http://0.0.0.0:8080"));
