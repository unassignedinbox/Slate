import { readFile, writeFile, copyFile } from "node:fs/promises";
const files = [
  ["Three.js", "node_modules/three/LICENSE"],
  ["Earcut", "node_modules/earcut/LICENSE"],
  ["Lucide", "node_modules/lucide/LICENSE"],
  ["DM Sans", "node_modules/@fontsource-variable/dm-sans/LICENSE"],
  ["Clipper / JSBN", "licenses/clipper-boost-jsbn.txt"],
];
let notices = "Slate — bundled runtime dependency licenses\n\n";
for (const [name, path] of files)
  notices += `\n=== ${name} ===\n\n${await readFile(path, "utf8")}\n`;
await writeFile("published/THIRD_PARTY_LICENSES.txt", notices);
await copyFile("THIRD_PARTY_NOTICES.md", "published/THIRD_PARTY_NOTICES.md");
console.log(
  "Static entry point: published/index.html (relative assets and runtime license notices included).",
);
