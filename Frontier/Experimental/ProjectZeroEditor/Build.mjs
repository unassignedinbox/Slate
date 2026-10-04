import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const Folder = path.dirname(fileURLToPath(import.meta.url)),
  Frontier = path.resolve(Folder, "../..");
const Require = createRequire(
  path.resolve(Folder, "../FrontierEditor/package.json"),
);
const { build } = Require("esbuild"),
  { createCanvas, loadImage } = Require("@napi-rs/canvas");
const Assets = {
  Icons: {},
  Glyphs: {},
  Moons: [],
  Fonts: Object.fromEntries(
    ["Light", "Regular"].map((Weight) => [
      Weight,
      "data:font/ttf;base64," +
        fs
          .readFileSync(
            path.join(
              Frontier,
              "EngineContent/Fonts/SunReference",
              "DMSans-" + Weight + ".ttf",
            ),
          )
          .toString("base64"),
    ]),
  ),
  ShaderBall: fs
    .readFileSync(
      path.join(Frontier, "Exhibits/DistanceFieldGI/ShaderBall.mesh"),
    )
    .toString("base64"),
  Notices: {
    Fonts: fs.readFileSync(
      path.join(Frontier, "EngineContent/Fonts/SunReference/OFL.txt"),
      "utf8",
    ),
    Icons: fs.readFileSync(
      path.join(Frontier, "EngineContent/Icons/Slate-NOTICE.md"),
      "utf8",
    ),
  },
};
for (const File of fs
  .readdirSync(path.join(Frontier, "EngineContent/Icons"))
  .filter((Name) => Name.endsWith(".svg"))) {
  Assets.Icons[File.slice(0, -4)] =
    "data:image/svg+xml;base64," +
    fs
      .readFileSync(path.join(Frontier, "EngineContent/Icons", File))
      .toString("base64");
}
const Vectors = fs.readFileSync(
  path.join(Frontier, "Engine/DisplayPresentation/VectorCodec.cpp"),
  "utf8",
);
for (const Match of Vectors.matchAll(
  /VectorGlyphRecord\s*\{\s*"([^"]+)"\s*,\s*"([^"]+)"/g,
))
  Assets.Glyphs[Match[1]] = Match[2];
for (const Name of ["luna", "ember", "glacier", "sulfur", "shroud", "shard"]) {
  const Image = await loadImage(
    path.join(Frontier, "EngineContent/CelestialTextures", Name + "_2k.jpg"),
  );
  const Canvas = createCanvas(512, 256);
  Canvas.getContext("2d").drawImage(Image, 0, 0, 512, 256);
  Assets.Moons.push(Canvas.toDataURL("image/jpeg", 0.9));
}
const Fonts = ["Light", "Regular"]
  .map(
    (Weight, Index) =>
      `@font-face{font-family:'DM Sans';font-style:normal;font-weight:${Index ? 400 : 300};font-display:swap;src:url(data:font/ttf;base64,${fs.readFileSync(path.join(Frontier, "EngineContent/Fonts/SunReference", "DMSans-" + Weight + ".ttf")).toString("base64")}) format('truetype')}`,
  )
  .join("\n");
const Output = await build({
  entryPoints: [path.join(Folder, "Editor.jsx")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  outfile: "Editor.js",
  nodePaths: [path.join(Folder, "../FrontierEditor/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
  target: ["chrome110", "firefox115", "safari16"],
});
const Script = Output.outputFiles.find((File) =>
    File.path.endsWith(".js"),
  ).text,
  Style = Output.outputFiles.find((File) => File.path.endsWith(".css")).text;
fs.writeFileSync(
  path.join(Folder, "index.html"),
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Project Zero native editor UI translated to HTML. Native icons and fonts; browser-local controls, no engine connection."><title>Project-Zero — Editor</title><style>${Fonts}\n${Style}</style></head><body><div id="Editor"></div><script>window.NativeAssets=${JSON.stringify(Assets).replaceAll("<", "\\u003c")};</script><script>${Script.replaceAll("</script", "<\\/script")}</script></body></html>\n`,
);
console.log(
  `Built standalone index.html (${(fs.statSync(path.join(Folder, "index.html")).size / 1024 / 1024).toFixed(2)} MiB), ${Object.keys(Assets.Icons).length} shipped icons, ${Object.keys(Assets.Glyphs).length} native vector glyphs, six moon textures, and the repository shader-ball mesh.`,
);
