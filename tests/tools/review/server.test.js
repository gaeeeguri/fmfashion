import { test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReviewServer } from '../../../tools/review/server.js';

let srv;
afterEach(() => srv?.close());

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-review-'));
  writeFileSync(join(dir, 'brands-review.tsv'), '결정\tid\t이름\t검색어\ny\tkinch\t킨치\t킨치\n');
  writeFileSync(join(dir, 'groups.tsv'), 'id\t이름\nminimal\t미니멀\n');
  writeFileSync(join(dir, 'suggestions.json'), JSON.stringify({ kinch: { variants: [['킨치이', 2]], follow: [['808', 14]] } }));
  return dir;
}

test('serves the table, groups and suggestions', async () => {
  const dir = fixture();
  srv = await openReviewServer({ dir, port: 0, run: async () => ({ code: 0, output: '' }) });
  const d = await (await fetch(`${srv.url}/api/data`)).json();
  expect(d.rows[0]).toMatchObject({ id: 'kinch', 검색어: '킨치' });
  expect(d.groups).toEqual([{ id: 'minimal', 이름: '미니멀' }]);
  expect(d.suggestions.kinch.follow[0]).toEqual(['808', 14]);
});

test('save writes both tables back', async () => {
  const dir = fixture();
  srv = await openReviewServer({ dir, port: 0, run: async () => ({ code: 0, output: '' }) });
  const d = await (await fetch(`${srv.url}/api/data`)).json();
  d.rows[0].검색어 = '킨치;808';
  d.groups.push({ id: 'shoes', 이름: '구두' });
  const r = await fetch(`${srv.url}/api/save`, { method: 'POST', body: JSON.stringify({ rows: d.rows, groups: d.groups }) });
  expect(r.status).toBe(200);
  expect(readFileSync(join(dir, 'brands-review.tsv'), 'utf8')).toContain('킨치;808');
  expect(readFileSync(join(dir, 'groups.tsv'), 'utf8')).toBe('id\t이름\nminimal\t미니멀\nshoes\t구두\n');
});

test('preview and apply run the apply step without and with --write', async () => {
  const dir = fixture();
  const calls = [];
  srv = await openReviewServer({ dir, port: 0, run: async (write) => (calls.push(write), { code: 0, output: write ? '저장' : '미리보기' }) });
  const p = await (await fetch(`${srv.url}/api/preview`, { method: 'POST' })).json();
  const a = await (await fetch(`${srv.url}/api/apply`, { method: 'POST' })).json();
  expect([p.output, a.output]).toEqual(['미리보기', '저장']);
  expect(calls).toEqual([false, true]);
});

test('only answers on 127.0.0.1 and refuses other origins', async () => {
  srv = await openReviewServer({ dir: fixture(), port: 0, run: async () => ({ code: 0, output: '' }) });
  expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const r = await fetch(`${srv.url}/api/save`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  expect(r.status).toBe(403);
});

test('refuses requests whose Host is not the loopback address (DNS rebinding)', async () => {
  srv = await openReviewServer({ dir: fixture(), port: 0, run: async () => ({ code: 0, output: '' }) });
  const { request } = await import('node:http');
  const status = await new Promise((resolve) => {
    const u = new URL(`${srv.url}/api/data`);
    request({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: `evil.example:${u.port}` } }, (res) => resolve(res.statusCode)).end();
  });
  expect(status).toBe(403);
});
