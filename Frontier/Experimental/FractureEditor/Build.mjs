import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Result = await build({
  entryPoints: [path.join(Folder, "FracturePanel.js")],
  bundle: true,
  minify: true,
  format: "iife",
  write: false,
  target: "es2022",
});
const Script = Result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const Html = fs
  .readFileSync(path.join(Folder, "FracturePanel.html"), "utf8")
  .replace(
    "/* INLINE_STYLE */",
    fs.readFileSync(path.join(Folder, "FracturePanel.css"), "utf8"),
  )
  .replace("/* INLINE_SCRIPT */", () => Script);
fs.writeFileSync(path.join(Folder, "index.html"), Html);
console.log(
  `Built standalone fracture editor: ${(Buffer.byteLength(Html) / 1048576).toFixed(2)} MiB`,
);
