import { buildSearchJobs } from './query.js';
import { runSearch } from './runner.js';
import { filterRows, mergeRows } from './merge.js';

export const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {{
 *   status: 'idle' | 'empty' | 'running' | 'done' | 'blocked' | 'cancelled' | 'error',
 *   reason?: string, rows: import('./merge.js').ResultRow[], progress: { done: number, total: number, term: string } | null,
 *   jobs: import('./query.js').SearchJob[], totalTerms: number, moreLabel: '더 보기' | '이어서 검색' | null,
 *   fromCache: { savedAt: number } | null,
 * }} ResultsState
 */

/**
 * Owns one search session for the results page. Only the latest run may touch state, and a new
 * run starts only after the previous one has fully stopped.
 * @param {{ dict: import('./dictionary.js').Dictionary, matchers: import('./matcher.js').Matchers,
 *   fetchPage: Function, cache: { get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void> },
 *   now?: () => number, runOpts?: { sleep?: Function, random?: () => number }, onChange?: (s: ResultsState) => void }} deps
 */
export function createResultsController({ dict, matchers, fetchPage, cache, now = Date.now, runOpts = {}, onChange = () => {} }) {
  /** @type {ResultsState} */
  const state = { status: 'idle', rows: [], progress: null, jobs: [], totalTerms: 0, moreLabel: null, fromCache: null };
  let settings = null;
  let category = null;
  let lastPage = []; // last fetched page per job index (0 = none)
  let pending = []; // job indices still to fetch at their next page
  let token = 0;
  let current = null; // { ctl, done: Promise }

  const emit = () => onChange(state);
  const cacheKey = () =>
    'results:' + [[...settings.selectedBrandIds].sort().join(','), settings.categoryKey, [...settings.hiddenBrandIds].sort().join(',')].join('|');

  async function stopCurrent() {
    if (!current) return;
    current.ctl.abort();
    await current.done;
  }

  async function run(indices) {
    await stopCurrent();
    const my = ++token;
    const ctl = new AbortController();
    const jobs = indices.map((i) => ({ ...state.jobs[i], page: lastPage[i] + 1, index: i }));
    Object.assign(state, { status: 'running', reason: undefined, progress: null, moreLabel: null });
    emit();

    const done = runSearch({
      ...runOpts,
      jobs,
      fetchPage,
      signal: ctl.signal,
      onProgress: (p) => {
        if (my !== token) return;
        state.progress = p;
        emit();
      },
      onRows: (incoming, job) => {
        if (my !== token) return;
        lastPage[job.index] = job.page;
        state.rows = mergeRows(state.rows, filterRows(incoming, { category, hiddenBrandIds: settings.hiddenBrandIds, matchers }), job.brandId, job.term);
        emit();
      },
    });
    current = { ctl, done: done.catch(() => {}) };
    const res = await done;
    if (current?.ctl === ctl) current = null;
    if (my !== token) return; // superseded: a newer run owns the state

    const finished = new Set(jobs.slice(0, res.completed).map((j) => j.index));
    const unfinished = indices.filter((i) => !finished.has(i));
    pending = res.status === 'done' ? state.jobs.map((_, i) => i) : unfinished;
    Object.assign(state, {
      status: res.status,
      reason: res.reason,
      progress: null,
      moreLabel: res.status === 'done' ? '더 보기' : pending.length ? '이어서 검색' : null,
    });
    if (res.status === 'done') await cache.set(cacheKey(), { rows: state.rows, lastPage, savedAt: now() });
    emit();
  }

  return {
    state,
    /** @param {import('./settings.js').Settings} s */
    async start(s, { useCache = true } = {}) {
      // Synchronously invalidate the old run and adopt the new settings before yielding,
      // so callers can render immediately and stale callbacks are ignored.
      token++;
      settings = s;
      category = dict.categories.find((c) => c.key === s.categoryKey) ?? dict.categories.find((c) => c.key === 'all');
      await stopCurrent();
      const { jobs, totalTerms } = buildSearchJobs({ dict, selectedBrandIds: s.selectedBrandIds, hiddenBrandIds: s.hiddenBrandIds });
      Object.assign(state, { jobs, totalTerms, rows: [], progress: null, moreLabel: null, fromCache: null, reason: undefined });
      lastPage = jobs.map(() => 0);
      pending = jobs.map((_, i) => i);
      if (!jobs.length) {
        state.status = 'empty';
        emit();
        return;
      }
      if (useCache) {
        const hit = await cache.get(cacheKey());
        if (hit && now() - hit.savedAt < CACHE_TTL_MS) {
          Object.assign(state, { status: 'done', rows: hit.rows, moreLabel: '더 보기', fromCache: { savedAt: hit.savedAt } });
          lastPage = hit.lastPage;
          emit();
          return;
        }
      }
      await run(pending);
    },
    async more() {
      if (state.status === 'running' || !pending.length) return;
      state.fromCache = null;
      await run(pending);
    },
    cancel() {
      current?.ctl.abort();
    },
    get category() {
      return category;
    },
  };
}
