import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCrawl } from '../../../tools/crawl/crawler.js';
import { openStore } from '../../../tools/crawl/store.js';
import { fakeClock } from './fakeClock.js';

const EXCLUDE = ['210029879', '209960683', '5263961399'];
const listUrl = (page) => `/index.php?mid=fashion&page=${page}`;
const listHtml = (ids, lastPage) =>
  '<div class="bd_lst_wrp"><table>' +
  ids
    .map(
      (id) =>
        `<tr><td class="cate"><a href="/index.php?mid=fashion&category=26143773">자유</a></td>` +
        `<td class="title"><a href="/${id}">t${id}</a></td></tr>`,
    )
    .join('') +
  `</table></div><form class="bd_pg" data-last-page="${lastPage}"></form>`;
const postHtml = (text) => `<div class="top_area"><span class="date">2026.11.04 10:00</span></div><article><div class="xe_content"><p>${text}</p></div></article>`;
const ok = (html) => ({ status: 200, html });

/** routes: url → response | response[] (consumed in order, last one repeats) */
function site(routes, { clock, delay = 0 } = {}) {
  const calls = [];
  const at = [];
  const fetchPage = async (url) => {
    calls.push(url);
    at.push(clock.now());
    if (delay) await clock.sleep(delay);
    const r = routes[url];
    if (Array.isArray(r)) return r.length > 1 ? r.shift() : r[0];
    if (r) return r;
    if (/^\/\d+$/.test(url)) return ok(postHtml(`본문 ${url}`));
    return ok(listHtml([], 1));
  };
  return { fetchPage, calls, at };
}

function setup({ dir = mkdtempSync(join(tmpdir(), 'fmf-')), routes, opts = {}, delay } = {}) {
  const clock = fakeClock();
  const s = site(routes, { clock, delay });
  const checkpoints = [];
  let waits = 0;
  const merged = Object.assign(opts, {
    sources: [{ category: null }],
    excludeCategoryIds: EXCLUDE,
    target: 100000,
    deadline: null,
    runUntil: null,
    checkpoints: [],
    refillBelow: 200,
    unrecognizedStreakLimit: 20,
    ...opts,
  });
  const run = () =>
    runCrawl({
      fetchPage: s.fetchPage,
      waitForNetwork: async () => {
        waits++;
      },
      store: openStore(dir),
      clock,
      opts: merged,
      onCheckpoint: (label, n) => checkpoints.push([label, n]),
      log: () => {},
    });
  return { dir, clock, calls: s.calls, at: s.at, checkpoints, run, waits: () => waits };
}
const postsIn = (dir) => readFileSync(join(dir, 'posts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const postCalls = (calls) => calls.filter((u) => /^\/\d+$/.test(u));

test('fetches every post on the list and stops when pages run out', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13], 1)) } });
  const r = await t.run();
  expect(r).toEqual({ reason: 'exhausted', postCount: 3 });
  expect(postsIn(t.dir).map((p) => [p.docId, p.text, p.categoryName])).toEqual([
    ['11', '본문 /11', '자유'],
    ['12', '본문 /12', '자유'],
    ['13', '본문 /13', '자유'],
  ]);
});

test('posts already stored are never fetched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-'));
  openStore(dir).appendPost({ docId: '12', text: 'x' });
  const t = setup({ dir, routes: { [listUrl(1)]: ok(listHtml([11, 12, 13], 1)) } });
  await t.run();
  expect(postCalls(t.calls)).toEqual(['/11', '/13']);
});

test('a rerun resumes without fetching any post twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-'));
  const routes = () => ({ [listUrl(1)]: ok(listHtml([11, 12, 13], 1)) });
  const a = setup({ dir, routes: routes(), opts: { runUntil: 600 } });
  const ra = await a.run();
  expect(ra.reason).toBe('for');
  const b = setup({ dir, routes: routes() });
  await b.run();
  expect(postsIn(dir).map((p) => p.docId).sort()).toEqual(['11', '12', '13']);
  const all = [...postCalls(a.calls), ...postCalls(b.calls)];
  expect(new Set(all).size).toBe(all.length);
});

test('network errors wait for the network and retry the same post without slowing down', async () => {
  const t = setup({
    routes: { [listUrl(1)]: ok(listHtml([11], 1)), '/11': [{ error: 'network' }, { error: 'timeout' }, ok(postHtml('복구'))] },
  });
  await t.run();
  expect(t.waits()).toBe(2);
  expect(postsIn(t.dir)[0].text).toBe('복구');
  expect(JSON.parse(readFileSync(join(t.dir, 'state.json'), 'utf8')).rateIndex).toBe(0);
});

test('a 429 on a list page pauses everything for 5 minutes, then retries that page', async () => {
  const t = setup({ routes: { [listUrl(1)]: [{ status: 429, html: '' }, ok(listHtml([11], 1))] } });
  const r = await t.run();
  expect(r.postCount).toBe(1);
  expect(t.calls.slice(0, 2)).toEqual([listUrl(1), listUrl(1)]);
  expect(t.at[1] - t.at[0]).toBeGreaterThanOrEqual(300000);
});

test('430 stops the crawl, records the reason and runs the final report once', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13, 14, 15, 16], 1)), '/12': { status: 430, html: '' } } });
  const r = await t.run();
  expect(r.reason).toBe('blocked');
  expect(JSON.parse(readFileSync(join(t.dir, 'state.json'), 'utf8')).stopReason).toBe('blocked');
  expect(t.checkpoints.filter(([l]) => l === 'final')).toHaveLength(1);
});

test('20 bodiless pages in a row stop the crawl and are fetched again on rerun', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-'));
  const ids = Array.from({ length: 25 }, (_, i) => 100 + i);
  const login = ok('<html><body>로그인</body></html>');
  const routes = { [listUrl(1)]: ok(listHtml(ids, 1)) };
  for (const id of ids) routes[`/${id}`] = login;
  const a = setup({ dir, routes });
  const r = await a.run();
  expect(r.reason).toBe('unrecognized-streak');
  expect(readFileSync(join(dir, 'unrecognized.jsonl'), 'utf8').trim().split('\n')).toHaveLength(20);
  const b = setup({ dir, routes: { [listUrl(1)]: ok(listHtml(ids, 1)) } });
  await b.run();
  const refetched = postCalls(b.calls);
  expect(refetched.length).toBeGreaterThanOrEqual(20);
  expect(postsIn(dir).filter((p) => !p.unrecognized)).toHaveLength(25);
});

test('a sporadic bodiless page is kept as unrecognized once a good post follows', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12], 1)), '/11': ok('<p>삭제된 글</p>') } });
  await t.run();
  const p11 = postsIn(t.dir).find((p) => p.docId === '11');
  expect(p11).toMatchObject({ unrecognized: true, status: 200 });
});

test('a 404 post is stored as unrecognized and not refetched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-'));
  const routes = () => ({ [listUrl(1)]: ok(listHtml([11, 12], 1)), '/11': { status: 404, html: '' } });
  const a = setup({ dir, routes: routes() });
  await a.run();
  expect(postsIn(dir).find((p) => p.docId === '11')).toMatchObject({ unrecognized: true, status: 404 });
  const b = setup({ dir, routes: routes() });
  await b.run();
  expect(postCalls(b.calls)).not.toContain('/11');
});

test('a checkpoint crossed while the crawler was down fires once on start, never again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmf-'));
  const s = openStore(dir);
  s.appendPost({ docId: '1', text: 'a' });
  s.appendPost({ docId: '2', text: 'b' });
  const a = setup({ dir, routes: {}, opts: { checkpoints: [2] } });
  await a.run();
  expect(a.checkpoints.filter(([l]) => l === 2)).toEqual([[2, 2]]);
  const b = setup({ dir, routes: {}, opts: { checkpoints: [2] } });
  await b.run();
  expect(b.checkpoints.filter(([l]) => l === 2)).toEqual([]);
});

test('the deadline lets in-flight requests finish and runs the final report once', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13, 14, 15, 16], 1)) }, opts: { deadline: 1200 }, delay: 1000 });
  const r = await t.run();
  expect(r.reason).toBe('deadline');
  expect(postsIn(t.dir).length).toBe(postCalls(t.calls).length);
  expect(postsIn(t.dir).length).toBeGreaterThan(0);
  expect(t.checkpoints.filter(([l]) => l === 'final')).toHaveLength(1);
});

test('stops at the target count', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13, 14, 15], 1)) }, opts: { target: 3 } });
  const r = await t.run();
  expect(r).toEqual({ reason: 'target', postCount: 3 });
});

test('the pilot run (--for) ends with a pilot report, not a final one', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13], 1)) }, opts: { runUntil: 600 } });
  await t.run();
  expect(t.checkpoints.map(([l]) => l)).toEqual(['pilot']);
});

test('an interrupt (Ctrl-C) stops after in-flight work without any report', async () => {
  const opts = { interrupted: false };
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12, 13, 14, 15, 16], 1)) }, opts, delay: 1000 });
  setTimeout(() => (opts.interrupted = true), 0);
  const r = await t.run();
  expect(r.reason).toBe('interrupted');
  expect(t.checkpoints).toEqual([]);
});

test('opts.rates sets the pace: 0.1/s starts requests 10s apart', async () => {
  const t = setup({ routes: { [listUrl(1)]: ok(listHtml([11, 12], 1)) }, opts: { rates: [0.1], maxInFlight: 1 } });
  await t.run();
  expect(t.at.slice(0, 3)).toEqual([0, 10000, 20000]);
});
