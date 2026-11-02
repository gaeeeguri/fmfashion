// @vitest-environment jsdom
import { expect } from 'vitest';
import { fixture, ftest } from './fixtures.js';
import { runSearch, abortableSleep } from '../../src/lib/runner.js';

const LIST = fixture('search-result.html');
const BLOCKED = fixture('blocked-430.html');
const jobs = ['a', 'b', 'c', 'd'].map((t) => ({ term: t, brandId: 'x', keyword: t }));

function fakeFetch(responses) {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  const fetchPage = async (url) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    calls.push(url);
    await Promise.resolve();
    inflight--;
    return responses[calls.length - 1] ?? { status: 200, html: LIST };
  };
  return { fetchPage, calls, max: () => maxInflight };
}
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };

ftest('requests sequentially with delay', async () => {
  sleeps.length = 0;
  const f = fakeFetch([]);
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, sleep, random: () => 0.999, onRows: () => {} });
  expect(res).toEqual({ status: 'done', completed: 4 });
  expect(f.calls.length).toBe(4);
  expect(f.max()).toBe(1);
  expect(sleeps.length).toBe(3);
  expect(sleeps.every((ms) => ms >= 1000 && ms < 1500)).toBe(true);
});
ftest('stops on blocked and keeps prior rows', async () => {
  const f = fakeFetch([{ status: 200, html: LIST }, { status: 200, html: LIST }, { status: 430, html: '' }]);
  const seen = [];
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, sleep, onRows: (rows, job) => seen.push([rows.length, job.term]) });
  expect(res.status).toBe('blocked');
  expect(f.calls.length).toBe(3);
  expect(seen).toEqual([[20, 'a'], [20, 'b']]);
});
ftest('blocked html with status 200 also stops', async () => {
  const f = fakeFetch([{ status: 200, html: BLOCKED }]);
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, sleep, onRows: () => {} });
  expect(res).toEqual({ status: 'blocked', completed: 0 });
  expect(f.calls.length).toBe(1);
});
ftest('cancel stops before next request', async () => {
  const f = fakeFetch([]);
  const ctl = new AbortController();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, sleep, signal: ctl.signal, onRows: () => ctl.abort() });
  expect(res.status).toBe('cancelled');
  expect(f.calls.length).toBe(1);
});
ftest('fetch error returns error', async () => {
  let n = 0;
  const fetchPage = async () => { if (++n === 2) throw new Error('net'); return { status: 200, html: LIST }; };
  const res = await runSearch({ jobs, fetchPage, sleep, onRows: () => {} });
  expect(res).toEqual({ status: 'error', completed: 1 });
});
ftest('passes page and categoryId into url and reports progress', async () => {
  const f = fakeFetch([]);
  const progress = [];
  await runSearch({ jobs: jobs.slice(0, 2), page: 2, categoryId: '18910473', fetchPage: f.fetchPage, sleep, onRows: () => {}, onProgress: (p) => progress.push(p) });
  expect(f.calls[0]).toContain('page=2');
  expect(f.calls[0]).toContain('category=18910473');
  expect(progress).toEqual([{ done: 0, total: 2, term: 'a' }, { done: 1, total: 2, term: 'b' }]);
});

ftest('unrecognized page (no list table) returns error', async () => {
  const f = fakeFetch([{ status: 200, html: '<html><body>로그인이 필요합니다</body></html>' }]);
  const seen = [];
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, sleep, onRows: (r) => seen.push(r) });
  expect(res).toEqual({ status: 'error', completed: 0, reason: 'unrecognized' });
  expect(seen).toEqual([]);
});
ftest('job-level page overrides run page', async () => {
  const f = fakeFetch([]);
  await runSearch({ jobs: [{ ...jobs[0], page: 3 }, jobs[1]], page: 1, fetchPage: f.fetchPage, sleep, onRows: () => {} });
  expect(f.calls[0]).toContain('page=3');
  expect(f.calls[1]).toContain('page=1');
});
ftest('abortableSleep resolves early on abort', async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = abortableSleep(5000, ctl.signal);
  setTimeout(() => ctl.abort(), 10);
  await p;
  expect(Date.now() - t0).toBeLessThan(1000);
});
