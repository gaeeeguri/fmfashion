#!/usr/bin/env node
// Local review page for the brand table (Phase 2-B). Runs on 127.0.0.1 only: the table holds snippets of
// other people's posts, which stay on this Mac. See tools/review/README.md.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTsv, toTsv } from './tsv.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const writeAtomic = (path, text) => {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
};

/** Runs apply_review.py; write=false previews, write=true saves brands.json and then runs the extension's tests. */
export function runApply(dir) {
  const exec = (cmd, args) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args, { cwd: ROOT });
      let output = '';
      p.stdout.on('data', (d) => (output += d));
      p.stderr.on('data', (d) => (output += d));
      p.on('close', (code) => resolve({ code, output }));
    });
  return async (write) => {
    const py = join(ROOT, 'tools', 'lexicon', '.venv', 'bin', 'python');
    const args = [join(ROOT, 'tools', 'lexicon', 'apply_review.py'), '--review', join(dir, 'brands-review.tsv'), '--groups', join(dir, 'groups.tsv')];
    const r = await exec(py, write ? [...args, '--write'] : args);
    if (!write || r.code !== 0) return r;
    const t = await exec('npx', ['vitest', 'run', 'tests/lib']);
    const tail = t.output.split('\n').filter((l) => /Tests|FAIL|×/.test(l)).join('\n');
    return { code: t.code, output: `${r.output}\n익스텐션 테스트:\n${tail}` };
  };
}

/** @param {{ dir: string, port?: number, run: (write: boolean) => Promise<{code: number, output: string}> }} o */
export function openReviewServer({ dir, port = 47824, run }) {
  const tablePath = join(dir, 'brands-review.tsv');
  const groupsPath = join(dir, 'groups.tsv');
  const suggestPath = join(dir, 'suggestions.json');
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let s = '';
      req.on('data', (d) => (s += d));
      req.on('end', () => resolve(s));
    });

  const server = createServer(async (req, res) => {
    // DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) return send(res, 403, { error: 'host' });
    // a page on another site must not be able to rewrite the table through this port
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${server.address().port}`) return send(res, 403, { error: 'origin' });
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html'))
        return send(res, 200, readFileSync(join(HERE, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/api/data') {
        const table = parseTsv(readFileSync(tablePath, 'utf8'));
        return send(res, 200, {
          header: table.header,
          rows: table.rows,
          groups: parseTsv(readFileSync(groupsPath, 'utf8')).rows,
          suggestions: existsSync(suggestPath) ? JSON.parse(readFileSync(suggestPath, 'utf8')) : {},
        });
      }
      if (req.method === 'POST' && req.url === '/api/save') {
        const { rows, groups } = JSON.parse(await readBody(req));
        const header = parseTsv(readFileSync(tablePath, 'utf8')).header;
        writeAtomic(tablePath, toTsv({ header, rows }));
        writeAtomic(groupsPath, toTsv({ header: ['id', '이름'], rows: groups }));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (req.url === '/api/preview' || req.url === '/api/apply'))
        return send(res, 200, await run(req.url === '/api/apply'));
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e.message ?? e) });
    }
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }),
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(ROOT, 'data', 'review');
  const srv = await openReviewServer({ dir, run: runApply(dir) });
  console.log(`브랜드 검토 화면: ${srv.url}  (끝내려면 Ctrl-C)`);
}
