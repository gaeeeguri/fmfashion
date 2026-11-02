import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const out = `fmfashion-${version}.zip`;
rmSync(out, { force: true });
if (!existsSync('dist/manifest.json')) throw new Error('run npm run build first');
// spike/ is a dev-only probe page and must never ship to the store.
execFileSync('zip', ['-qr', `../${out}`, '.', '-x', 'spike/*'], { cwd: 'dist', stdio: 'inherit' });
console.log('zipped →', out);
