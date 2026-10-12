//============================================================================================================================================
// 🧪 tools/loader.mjs — Node resolution hooks so the editor's modules can be imported outside a bundler
//============================================================================================================================================
// Two things main.js says that Node cannot read on its own: a stylesheet (`import './UI/road-editor.css'`) and Vite's worker import (`?worker`).
//    Both are resolved away rather than mocked, so nothing in the app needs to know it is being tested.
const WORKER_STUB = 'export default class WorkerStub { constructor() { this.onmessage = null; this.onerror = null; } postMessage() {} terminate() {} }';

export async function resolve(specifier, context, next) {
    if (/\.css(\?|$)/.test(specifier)) return { url: 'data:text/javascript,export default {}', format: 'module', shortCircuit: true };
    if (/\?worker$/.test(specifier)) return { url: 'data:text/javascript,' + encodeURIComponent(WORKER_STUB), format: 'module', shortCircuit: true };
    return next(specifier, context);
}
