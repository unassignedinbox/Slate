//==========================================================================================
// Contract check for the interface layer. app.js, the panels and index.html have to agree on
// names that nothing else verifies: element identifiers, exported symbols, and the engine
// methods they call. A rename in one file used to surface only as a blank page in the browser,
// which is the worst possible place to find it. This runs the same checks in CI.
//
// Usage: node tools/verify-ui.mjs
//==========================================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const problems = [];
const notes = [];

function walk(directory)
{
    const found = [];
    for (const entry of readdirSync(directory))
    {
        const path = join(directory, entry);
        if (statSync(path).isDirectory())
        {
            found.push(...walk(path));
        }
        else if (path.endsWith('.js') || path.endsWith('.mjs'))
        {
            found.push(path);
        }
    }
    return found;
}

const sources = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tools')).filter((p) => !p.endsWith('verify-ui.mjs')));
const sourceText = new Map(sources.map((path) => [path, readFileSync(path, 'utf8')]));
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ---------------------------------------------------------------- module resolution
const exportCache = new Map();

function exportsOf(path)
{
    if (exportCache.has(path))
    {
        return exportCache.get(path);
    }
    const text = readFileSync(path, 'utf8');
    const names = new Set();
    for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm))
    {
        names.add(match[1]);
    }
    for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm))
    {
        for (const part of match[1].split(','))
        {
            const token = part.trim().split(/\s+as\s+/).pop().trim();
            if (token)
            {
                names.add(token);
            }
        }
    }
    exportCache.set(path, names);
    return names;
}

function checkImports(path, text)
{
    for (const match of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+'([^']+)'/g))
    {
        const symbols = match[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        const specifier = match[2];
        if (!specifier.startsWith('.'))
        {
            continue;
        }
        const target = resolve(dirname(path), specifier);
        if (!existsSync(target))
        {
            problems.push(`${relative(ROOT, path)} imports missing module ${specifier}`);
            continue;
        }
        const available = exportsOf(target);
        for (const symbol of symbols)
        {
            if (!available.has(symbol))
            {
                problems.push(`${relative(ROOT, path)} imports ${symbol} from ${specifier}, which does not export it`);
            }
        }
    }
}

// ---------------------------------------------------------------- element identifiers
const declaredIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const referencedIds = new Map();

for (const [path, text] of sourceText)
{
    for (const match of text.matchAll(/(?:getElementById|byId|querySelector)\(\s*['"]#?([A-Za-z][\w-]*)['"]\s*\)/g))
    {
        const name = match[1];
        if (!referencedIds.has(name))
        {
            referencedIds.set(name, new Set());
        }
        referencedIds.get(name).add(relative(ROOT, path));
    }
    // The panels set text through helpers that take the identifier as an argument, so a literal
    // mention anywhere is what "reads this element" means for this check.
    for (const match of text.matchAll(/['"]([A-Za-z][\w-]*)['"]/g))
    {
        if (declaredIds.has(match[1]))
        {
            if (!referencedIds.has(match[1]))
            {
                referencedIds.set(match[1], new Set());
            }
            referencedIds.get(match[1]).add(relative(ROOT, path));
        }
    }
}

for (const [name, files] of referencedIds)
{
    if (!declaredIds.has(name))
    {
        problems.push(`element "${name}" is used by ${[...files].join(', ')} but index.html never declares it`);
    }
}
for (const id of declaredIds)
{
    if (!referencedIds.has(id))
    {
        notes.push(`index.html declares "${id}" that no script reads`);
    }
}

// ---------------------------------------------------------------- engine surface
function classMembers(path, className)
{
    const text = readFileSync(path, 'utf8');
    if (!text.includes(`class ${className}`))
    {
        return new Set();
    }
    const names = new Set();
    // Methods: four-space members. Fields: anything assigned onto this, wherever it happens.
    for (const match of text.matchAll(/^ {4}(?:async\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/gm))
    {
        names.add(match[1]);
    }
    for (const match of text.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=/g))
    {
        names.add(match[1]);
    }
    return names;
}

const enginePath = join(ROOT, 'src/kernel/terrainEngine.js');
const terrainMethods = classMembers(enginePath, 'TerrainEngine');
const appText = sourceText.get(join(ROOT, 'src/app.js')) || '';
const engineCalls = new Set([...appText.matchAll(/\bengine\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

for (const name of engineCalls)
{
    if (!terrainMethods.has(name))
    {
        problems.push(`app.js calls engine.${name}(), which TerrainEngine does not define`);
    }
}

// ---------------------------------------------------------------- graph document surface
const graphPath = join(ROOT, 'src/kernel/graph/doc.js');
const graphMethods = classMembers(graphPath, 'History');
for (const [, name] of appText.matchAll(/\bhistory\.([A-Za-z_$][\w$]*)/g))
{
    if (!graphMethods.has(name))
    {
        problems.push(`app.js calls history.${name}(), which History does not define`);
    }
}

// ---------------------------------------------------------------- unused exports
const importedNames = new Set();
for (const [, text] of sourceText)
{
    for (const match of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+'[^']+'/g))
    {
        for (const part of match[1].split(','))
        {
            const token = part.trim().split(/\s+as\s+/)[0].trim();
            if (token)
            {
                importedNames.add(token);
            }
        }
    }
}
for (const path of sources)
{
    const relativePath = relative(ROOT, path);
    if (!relativePath.startsWith('src/ui/'))
    {
        continue;
    }
    for (const name of exportsOf(path))
    {
        if (!importedNames.has(name))
        {
            notes.push(`${relativePath} exports ${name} that nothing imports`);
        }
    }
}

// ---------------------------------------------------------------- report
for (const [path, text] of sourceText)
{
    checkImports(path, text);
}

console.log(`checked ${sources.length} modules, ${declaredIds.size} declared element identifiers, `
    + `${engineCalls.size} engine calls`);

if (notes.length > 0)
{
    console.log(`\nnotes (${notes.length})`);
    for (const note of notes)
    {
        console.log(`  NOTE  ${note}`);
    }
}

if (problems.length > 0)
{
    console.log(`\nproblems (${problems.length})`);
    for (const problem of problems)
    {
        console.log(`  FAIL  ${problem}`);
    }
    process.exitCode = 1;
}
else
{
    console.log('\nAll interface contracts hold.');
}
