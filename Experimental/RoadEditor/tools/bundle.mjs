// Builds the single-file editor.
//
//   node tools/bundle.mjs [out.html]
//
// The editor is authored as ordinary ES modules, which is the right way to work on it but the wrong
// way to hand it to anyone: a module graph needs an HTTP server and a permissive origin, and the
// sandboxed preview iframe has neither. So the release artefact is one HTML file with the CSS and
// the bundled JavaScript inlined — open it from the filesystem, drop it in a wiki, or preview it
// behind an allow-scripts iframe, and it runs.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = process.argv[2] || path.join(root, 'dist', 'ProjectZeroEditor.html');

const bundled = await build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  minify: true,
  legalComments: 'none',
  write: false,
});

const js = bundled.outputFiles[0].text;
const css = await fs.readFile(path.join(root, 'src', 'style.css'), 'utf8');
let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');

const scriptTag = html.includes('<script type="module" src="./src/app.js"></script>')
  ? '<script type="module" src="./src/app.js"></script>'
  : '<script type="module" src="src/app.js"></script>';
const linkTag = html.includes('<link rel="stylesheet" href="./src/style.css" />')
  ? '<link rel="stylesheet" href="./src/style.css" />'
  : '<link rel="stylesheet" href="src/style.css" />';

// The bundle is minified, so keep it out of the markup the editor could ever read as content by
// escaping the one sequence that would end the script element early.
html = html.replace(linkTag, `<style>\n${css}\n</style>`);
html = html.replace(scriptTag, `<script>\n${js.replace(/<\/script>/gi, '<\\/script>')}\n</script>`);
if (html.includes('src/app.js') || html.includes('src/style.css')) throw new Error('bundle: asset tags were not replaced');

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${out}  ${kb(html.length)}  (css ${kb(css.length)}, js ${kb(js.length)})`);
console.log('open the file directly, or serve the folder and point the preview at it');
