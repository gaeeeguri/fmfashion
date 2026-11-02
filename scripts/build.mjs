import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = 'src';
const OUT = 'dist';
const ENTRIES = ['background/sw.js', 'popup/popup.js', 'results/results.js', 'content/board.js'];
const STATIC = /\.(html|css|png|json)$/;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ENTRIES.filter((e) => existsSync(join(SRC, e))).map((e) => join(SRC, e)),
  outdir: OUT,
  outbase: SRC,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'warning',
});

function copyStatic(dir) {
  for (const ent of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    const rel = join(dir, ent.name);
    if (ent.isDirectory()) copyStatic(rel);
    else if (STATIC.test(ent.name)) {
      mkdirSync(dirname(join(OUT, rel)), { recursive: true });
      cpSync(join(SRC, rel), join(OUT, rel));
    }
  }
}
copyStatic('');
mkdirSync(join(OUT, 'dictionary'), { recursive: true });
cpSync('dictionary/brands.json', join(OUT, 'dictionary/brands.json'));
console.log('built →', OUT);
