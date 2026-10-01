import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';

if (existsSync('site/Source.html')) {
  renameSync('site/Source.html', 'site/index.html');
}

// WGSL template literals copied from upstream retain indentation whitespace.
// Trim line endings so the checked-in deterministic bundle passes Git checks.
for (const name of readdirSync('site/assets')) {
  if (!name.endsWith('.js') && !name.endsWith('.css')) continue;
  const path = `site/assets/${name}`;
  const source = readFileSync(path, 'utf8');
  writeFileSync(
    path,
    source
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n'),
  );
}
