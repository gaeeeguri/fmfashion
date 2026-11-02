// @vitest-environment jsdom
import { test, expect } from 'vitest';
import fs from 'node:fs';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { createResultsController } from '../../src/lib/resultsController.js';

const LIST = fs.readFileSync('tests/fixtures/search-result.html', 'utf8');
const matchers = compileMatchers(bundled);
const fastSleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, 1); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

function memCache() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m };
}
function fakeFetch(responses = []) {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  const fetchPage = async (url) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    calls.push(new URL(url).searchParams);
    await new Promise((r) => setTimeout(r, 3));
    inflight--;
    return responses[calls.length - 1] ?? { status: 200, html: LIST };
  };
  return { fetchPage, calls, max: () => maxInflight };
}
const make = (f, cache = memCache()) =>
  createResultsController({ dict: bundled, matchers, fetchPage: f.fetchPage, cache, runOpts: { sleep: fastSleep } });
const S = (brands, cat = 'all', hidden = []) => ({ selectedBrandIds: brands, categoryKey: cat, hiddenBrandIds: hidden });

test('restart mid-run: no overlapping fetches and no stale rows', async () => {
  const f = fakeFetch();
  const c = make(f);
  const first = c.start(S(['steadyeverywhere']));
  await new Promise((r) => setTimeout(r, 5));
  await c.start(S(['anotheroffice']));
  await first;
  expect(f.max()).toBe(1);
  expect(c.state.status).toBe('done');
  const brands = new Set(c.state.rows.flatMap((r) => r.hits.map((h) => h.brandId)));
  expect([...brands]).toEqual(['anotheroffice']);
});
test('after block, more resumes unfinished jobs at page 1', async () => {
  const f = fakeFetch([{ status: 200, html: LIST }, { status: 430, html: '' }]);
  const c = make(f);
  await c.start(S(['anotheroffice', 'paf']));
  expect(c.state.status).toBe('blocked');
  expect(c.state.rows.length).toBeGreaterThan(0);
  expect(c.state.moreLabel).toBe('이어서 검색');
  await c.more();
  const resumed = f.calls.slice(2).map((p) => [p.get('search_keyword'), p.get('page')]);
  expect(resumed).toEqual([['파프 !파프터', '1'], ['목동', '1']]);
  expect(c.state.status).toBe('done');
  expect(c.state.moreLabel).toBe('더 보기');
});
test('after done, more fetches next page for every job', async () => {
  const f = fakeFetch();
  const c = make(f);
  await c.start(S(['anotheroffice']));
  await c.more();
  expect(f.calls.slice(2).map((p) => p.get('page'))).toEqual(['2', '2']);
});
test('cache hit serves rows without fetching', async () => {
  const cache = memCache();
  await make(fakeFetch(), cache).start(S(['anotheroffice']));
  const f2 = fakeFetch();
  const c2 = make(f2, cache);
  await c2.start(S(['anotheroffice']));
  expect(f2.calls.length).toBe(0);
  expect(c2.state.fromCache).not.toBeNull();
  expect(c2.state.rows.length).toBeGreaterThan(0);
  await c2.start(S(['anotheroffice']), { useCache: false });
  expect(f2.calls.length).toBe(2);
});
test('unrecognized page sets error with reason', async () => {
  const f = fakeFetch([{ status: 200, html: '<html><body>?</body></html>' }]);
  const c = make(f);
  await c.start(S(['anotheroffice']));
  expect(c.state.status).toBe('error');
  expect(c.state.reason).toBe('unrecognized');
});
test('cancel stops the run and offers resume', async () => {
  const f = fakeFetch();
  const c = make(f);
  const p = c.start(S(['steadyeverywhere']));
  await new Promise((r) => setTimeout(r, 5));
  c.cancel();
  await p;
  expect(c.state.status).toBe('cancelled');
  expect(c.state.moreLabel).toBe('이어서 검색');
  expect(f.calls.length).toBeLessThan(5);
});
test('empty selection does not fetch', async () => {
  const f = fakeFetch();
  const c = make(f);
  await c.start(S([]));
  expect(c.state.status).toBe('empty');
  expect(f.calls.length).toBe(0);
});
test('category is available synchronously after start() is called', () => {
  const c = make(fakeFetch());
  const p = c.start(S(['anotheroffice'], 'fit'));
  expect(c.category?.key).toBe('fit');
  return p;
});
