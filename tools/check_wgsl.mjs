// check_wgsl.mjs — parses + validates every shader module with the real WGSL toolchain (naga-wasm,
// the same naga wgpu uses). Mirrors js/loader.js exactly: `//@@common` splices common.wgsl after
// `//@@strip KEY ...` regions have been removed, and `//@@region KEY ... //@@end KEY` marks them.
import { parseWgsl, validate } from "naga-wasm";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export function loadModuleSource(fileOrSrc, isSrc = false) {
  let src = isSrc ? fileOrSrc : fs.readFileSync(fileOrSrc, "utf8");
  let common = fs.readFileSync(path.join(ROOT, "shaders", "common.wgsl"), "utf8");
  // strip lists live on the module's own first lines
  const stripMatch = src.match(/^\/\/@@strip\s+(.+)$/m);
  const keys = stripMatch ? stripMatch[1].trim().split(/\s+/) : [];
  for (const key of keys) {
    const re = new RegExp(`//@@region ${key}[\\s\\S]*?//@@end ${key}\\n`, "gm");
    const before = common.length;
    common = common.replace(re, "");
    if (common.length === before && before > 0) console.warn(`  warn: strip key '${key}' matched nothing`);
  }
  src = src.replace("//@@common", () => common);
  // leftover strip directive lines are comments anyway
  return src;
}

let fail = 0;
const dir = path.join(ROOT, "shaders");
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".wgsl")).sort()) {
  if (f === "common.wgsl") continue;
  const p = path.join(dir, f);
  const src = loadModuleSource(p);
  try {
    const m = parseWgsl(src);
    try {
      const info = validate(m);
      info.free?.();
      console.log(`OK    ${f}`);
    } catch (e) {
      fail++;
      console.log(`FAIL  ${f}\n${String(e.message ?? e).split("\n").slice(0, 24).join("\n")}`);
    }
    m.free?.();
  } catch (e) {
    fail++;
    console.log(`PARSE ${f}\n${String(e.message ?? e).split("\n").slice(0, 24).join("\n")}`);
  }
}
process.exit(fail ? 1 : 0);
