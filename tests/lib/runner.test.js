// @vitest-environment jsdom
import { expect } from 'vitest';
import { fixture, ftest } from './fixtures.js';
import { runSearch, abortableSleep } from '../../src/lib/runner.js';

const LIST = fixture('search-result.html');
const BLOCKED = fixture('blocked-430.html');
const jobs = ['a', 'b', 'c', 'd'].map((t, index) => ({ term: t, brandId: 'x', keyword: t, page: 1, index }));

/** responders: keyword → array of responses (consumed in order; last one repeats) or a function */
function fakeFetch(responders = {}) {
  const calls = [];
  const signals = [];
  let inflight = 0;
  let max = 0;
  const fetchPage = async (url, signal) => {
    const k = new URL(url).searchParams.get('search_keyword');
    calls.push(k);
    signals.push(signal);
    inflight++;
    max = Math.max(max, inflight);
    try {
      const r = responders[k];
      if (typeof r === 'function') return await r(signal);
      await new Promise((res) => setTimeout(res, 1));
      if (Array.isArray(r)) return r.length > 1 ? r.shift() : r[0];
      return { status: 200, html: LIST };
    } finally {
      inflight--;
    }
  };
  return { fetchPage, calls, signals, max: () => max };
}
const hang = (signal) =>
  new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true }));

function harness() {
  const h = { takes: 0, sleeps: [], results: [] };
  h.take = async () => { h.takes++; };
  h.sleep = async (ms) => { h.sleeps.push(ms); };
  h.onResult = (job, page) => h.results.push([job.term, page.items.length, page.lastPage]);
  return h;
}

ftest('runs all jobs in parallel', async () => {
  const f = fakeFetch();
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res).toEqual({ status: 'done', failed: [] });
  expect(f.max()).toBe(4);
  expect(h.results.map((r) => r[2])).toEqual([2, 2, 2, 2]);
});
ftest('takes a token per request', async () => {
  const h = harness();
  await runSearch({ jobs, fetchPage: fakeFetch().fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(h.takes).toBe(4);
});
ftest('retries 429 with backoff then succeeds', async () => {
  const f = fakeFetch({ a: [{ status: 429, html: '' }, { status: 429, html: '' }, { status: 200, html: LIST }] });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res).toEqual({ status: 'done', failed: [] });
  expect(h.sleeps).toEqual([1000, 2000]);
  expect(h.takes).toBe(6);
  expect(h.results.length).toBe(4);
});
ftest('gives up after 3 retries', async () => {
  const f = fakeFetch({ a: [{ status: 429, html: '' }] });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res).toEqual({ status: 'done', failed: [{ job: jobs[0], reason: 'limited' }] });
  expect(h.sleeps).toEqual([1000, 2000, 4000]);
  expect(f.calls.filter((k) => k === 'a').length).toBe(4);
  expect(h.results.map((r) => r[0]).sort()).toEqual(['b', 'c', 'd']);
});
ftest('430 aborts the run', async () => {
  const f = fakeFetch({ a: hang, c: hang, d: hang, b: [{ status: 430, html: '' }] });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res.status).toBe('blocked');
  expect(f.signals.every((s) => s.aborted)).toBe(true);
  expect(h.results).toEqual([]);
});
ftest('blocked marker html counts as blocked', async () => {
  const f = fakeFetch({ a: [{ status: 200, html: BLOCKED }] });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res.status).toBe('blocked');
});
ftest('unrecognized page fails only that job', async () => {
  const f = fakeFetch({ c: [{ status: 200, html: '<html></html>' }] });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res).toEqual({ status: 'done', failed: [{ job: jobs[2], reason: 'unrecognized' }] });
  expect(h.results.length).toBe(3);
});
ftest('network error fails only that job', async () => {
  const f = fakeFetch({ d: async () => { throw new TypeError('net'); } });
  const h = harness();
  const res = await runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult });
  expect(res).toEqual({ status: 'done', failed: [{ job: jobs[3], reason: 'error' }] });
});
ftest('external abort → cancelled', async () => {
  const f = fakeFetch({ a: hang, b: hang, c: hang, d: hang });
  const h = harness();
  const ctl = new AbortController();
  const p = runSearch({ jobs, fetchPage: f.fetchPage, take: h.take, sleep: h.sleep, signal: ctl.signal, onResult: h.onResult });
  setTimeout(() => ctl.abort(), 5);
  expect((await p).status).toBe('cancelled');
});
ftest('uses job page in url and reports each settled job', async () => {
  const urls = [];
  const settled = [];
  const fetchPage = async (url) => { urls.push(url); return { status: 200, html: LIST }; };
  const h = harness();
  await runSearch({
    jobs: [{ ...jobs[0], page: 3 }], fetchPage, take: h.take, sleep: h.sleep, onResult: h.onResult,
    onSettled: (job) => settled.push(job.term),
  });
  expect(urls[0]).toContain('page=3');
  expect(urls[0]).not.toContain('category=');
  expect(settled).toEqual(['a']);
});
ftest('abortableSleep resolves early on abort', async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = abortableSleep(5000, ctl.signal);
  setTimeout(() => ctl.abort(), 10);
  await p;
  expect(Date.now() - t0).toBeLessThan(1000);
});
