import { existsSync, renameSync } from 'node:fs';

if (existsSync('site/Source.html')) {
  renameSync('site/Source.html', 'site/index.html');
}
