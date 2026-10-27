//============================================================================================================================================
// 📦 PreviewHost — static file host for the FoliageSketcher WebGL preview (development only).
//============================================================================================================================================
// Serves Tools/FoliageSketcher/Source at / and the baked sheets at /SheetArchives. Binds 0.0.0.0 so the sandbox
//    preview proxy can reach it. No caching: every reload picks up an edited shader immediately.
//
// Run:  node Tools/FoliageSketcher/Build/PreviewHost.mjs [port]

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HereDirectory   = dirname(fileURLToPath(import.meta.url));
const ToolDirectory   = resolve(HereDirectory, "..");
const SourceDirectory = join(ToolDirectory, "Source");
const ShaderDirectory = join(ToolDirectory, "Shaders");
const SheetDirectory  = join(ToolDirectory, "Content", "SheetArchives");
const FontDirectory   = resolve(ToolDirectory, "..", "..", "EngineContent", "FontArchives");

const ListenPort = Number(process.argv[2] ?? 8080);

const MediaCategory =
{
    ".html": "text/html; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".mjs":  "text/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".glsl": "text/plain; charset=utf-8",
    ".toml": "text/plain; charset=utf-8",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".otf":  "font/otf",
    ".ttf":  "font/ttf",
    ".json": "application/json; charset=utf-8"
};

// Maps a request path onto one of the three served roots; refuses anything that climbs out of them.
function ResolveRequest(RequestPath)
{
    const Clean = normalize(decodeURIComponent(RequestPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");

    if (Clean === "/" || Clean === "") return join(SourceDirectory, "index.html");
    if (Clean.startsWith("/Shaders/"))       return join(ShaderDirectory, Clean.slice("/Shaders/".length));
    if (Clean.startsWith("/SheetArchives/")) return join(SheetDirectory,  Clean.slice("/SheetArchives/".length));
    if (Clean.startsWith("/FontArchives/"))  return join(FontDirectory,   Clean.slice("/FontArchives/".length));
    return join(SourceDirectory, Clean);
}

const PreviewServer = createServer(async (Request, Response) =>
{
    try
    {
        const Target = ResolveRequest(Request.url ?? "/");
        const Roots  = [SourceDirectory, ShaderDirectory, SheetDirectory, FontDirectory];
        if (!Roots.some((Root) => Target.startsWith(Root)))
        {
            Response.writeHead(403).end("forbidden");
            return;
        }

        const Record = await stat(Target);
        if (!Record.isFile()) { Response.writeHead(404).end("not found"); return; }

        const Body = await readFile(Target);
        Response.writeHead(200,
        {
            "Content-Type":  MediaCategory[extname(Target).toLowerCase()] ?? "application/octet-stream",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
        });
        Response.end(Body);
    }
    catch
    {
        Response.writeHead(404).end("not found");
    }
});

//============================================================================================================
// 🍞 Sheet check
//============================================================================================================
// The baked sheets are generated output and are not committed, so a fresh clone — or a wiped sandbox — starts
//    with an empty SheetArchives and the preview boots to a black screen with three 404s. Rather than leave
//    that for someone to diagnose, run the bake once on startup when the albedo is missing.

async function EnsureSheets()
{
    try
    {
        await stat(join(SheetDirectory, "FoliageSheet_Albedo.png"));
        return;
    }
    catch
    {
        console.log("FoliageSketcher sheets missing — running the bake once (about ten seconds)…");
    }

    const Baked = spawnSync(process.execPath, [join(HereDirectory, "SheetSequence.mjs")], { stdio: "inherit" });
    if (Baked.status !== 0) console.error("FoliageSketcher sheet build failed — the preview will load untextured.");
}

await EnsureSheets();

PreviewServer.listen(ListenPort, "0.0.0.0", () =>
{
    console.log(`FoliageSketcher preview listening on 0.0.0.0:${ListenPort}`);
});
