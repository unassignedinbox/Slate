//============================================================================================================================================
//                                                              LOADER.JS
//============================================================================================================================================
// 📦 WGSL module loading with the repo's two tiny conventions (identical to tools/check_wgsl.mjs, so the
//    validator sees exactly the text the browser compiles):
//      //@@common             — splice shaders/common.wgsl here
//      //@@strip A B C        — drop matching //@@region KEY .. //@@end KEY blocks from common first

let commonText = null;

export async function loadWgslModule(name) {
  if (commonText === null) commonText = await (await fetch("shaders/common.wgsl")).text();
  let src = await (await fetch(`shaders/${name}.wgsl`)).text();
  let common = commonText;
  const stripMatch = src.match(/^\/\/@@strip\s+(.+)$/m);
  const keys = stripMatch ? stripMatch[1].trim().split(/\s+/) : [];
  for (const key of keys) {
    const re = new RegExp(`//@@region ${key}[\\s\\S]*?//@@end ${key}\\n`, "gm");
    common = common.replace(re, "");
  }
  return src.replace("//@@common", common);
}
