#!/usr/bin/env node
// Build the game and publish dist/ to the gh-pages branch of origin (GitHub Pages).
//   npm run deploy            → vite build + force-push dist/ to origin/gh-pages
//   npm run deploy -- --no-build
// GitHub: Settings → Pages → "Deploy from a branch" → gh-pages / (root).
// The site is then served at https://<user>.github.io/<repo>/ (vite base is './').

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd, cwd = root) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

if (!process.argv.includes('--no-build')) run('npx vite build');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html no existe: falló el build');

const remote = out('git remote get-url origin');
const sha = out('git rev-parse --short HEAD');
const tmp = mkdtempSync(join(tmpdir(), 'apolo-pages-'));
try {
  cpSync(dist, tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), '');
  run('git init -q -b gh-pages', tmp);
  run('git add -A', tmp);
  run(`git commit -q -m "Publicar Proyecto Apolo (${sha})"`, tmp);
  run(`git push -f "${remote}" gh-pages`, tmp);
  console.log('\nPublicado en la rama gh-pages de', remote);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
