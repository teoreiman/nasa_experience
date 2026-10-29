#!/usr/bin/env node
// Fast static check (≈1–3 s): syntax of every src/**/*.js with esbuild + import resolution of the
// whole app bundled from src/main.js (dynamic imports included). Exit code 1 on any error.
//   node tools/check.mjs            → check all
//   node tools/check.mjs src/sim    → syntax-check only files under a path (+ full bundle)

import { build, transform } from 'esbuild';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const only = process.argv[2] ? resolve(root, process.argv[2]) : join(root, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

let errors = 0;
const files = statSync(only).isDirectory() ? walk(only) : [only];
for (const f of files) {
  try {
    await transform(readFileSync(f, 'utf8'), { loader: 'js', format: 'esm', sourcefile: relative(root, f) });
  } catch (err) {
    errors++;
    for (const e of err.errors ?? [err]) {
      const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : relative(root, f);
      console.error(`SYNTAX  ${loc}  ${e.text ?? e.message}`);
    }
  }
}

try {
  const res = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    write: false,
    splitting: true,
    format: 'esm',
    outdir: join(root, '.check-out'),
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    metafile: true,
    loader: { '.css': 'empty', '.woff': 'empty', '.woff2': 'empty', '.jpg': 'empty', '.png': 'empty', '.svg': 'empty', '.mp3': 'empty', '.glsl': 'text' },
    define: { 'import.meta.env.BASE_URL': '"./"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  });
  for (const w of res.warnings) {
    if (/import\.meta/.test(w.text)) continue;
    const loc = w.location ? `${w.location.file}:${w.location.line}` : '';
    console.warn(`WARN    ${loc}  ${w.text}`);
  }
  const inputs = Object.keys(res.metafile.inputs).filter((k) => k.startsWith('src/')).length;
  console.log(`bundle  ok (${inputs} módulos de src/ alcanzables)`);
} catch (err) {
  for (const e of err.errors ?? [err]) {
    errors++;
    const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : '';
    console.error(`BUNDLE  ${loc}  ${e.text ?? e.message}`);
  }
}

console.log(`${files.length} archivos revisados, ${errors} errores`);
process.exit(errors ? 1 : 0);
