import { buildSearchJobs, buildListJobs } from './query.js';
import { runSearch } from './runner.js';
import { filterRows, mergeRows } from './merge.js';

/**
 * @typedef {import('./merge.js').ResultRow & { tr: HTMLTableRowElement }} SessionRow
 * @typedef {{
 *   status: 'idle' | 'empty' | 'running' | 'done' | 'blocked' | 'cancelled',
 *   mode: 'search' | 'browse' | null,
 *   rows: SessionRow[],
 *   progress: { done: number, total: number } | null,
 *   totalTerms: number, jobCount: number,
 *   notice: null | 'limited' | 'unrecognized' | 'error',
 *   moreLabel: '더 보기' | '이어서 검색' | null,
 *   finished: boolean,
 *   autoLoad: boolean, // false after 3 rounds in a row added no visible row (spec §11.2 brake)
 * }} SessionState
 */

const NOTICE_ORDER = ['limited', 'unrecognized', 'error'];

/**
 * One brand-search session for a page (spec §5). Only the latest run may touch state; starting a
 * new run aborts the previous one. Nothing is cached.
 * @param {{ dict: import('./dictionary.js').Dictionary, matchers: import('./matcher.js').Matchers,
 *   fetchPage: Function, take: (signal?: AbortSignal) => Promise<void>, sleep?: Function,
 *   onChange?: (s: SessionState) => void }} deps
 */
export function createSearchSession({ dict, matchers, fetchPage, take, sleep, onChange = () => {} }) {
  /** @type {SessionState} */
  const state = {
    status: 'idle', mode: null, rows: [], progress: null, totalTerms: 0, jobCount: 0, notice: null, moreLabel: null, finished: false, autoLoad: true,
  };
  let sel = null;
  let category = null;
  let jobs = [];
  let fetched = []; // last fetched page per job (0 = none)
  let last = []; // known last page per job
  let unfinished = []; // job indices to retry at their next page ("이어서 검색")
  let token = 0;
  let emptyRounds = 0;
  const MAX_EMPTY_ROUNDS = 3;
  let current = null; // { ctl, done }

  const emit = () => onChange(state);

  async function stopCurrent() {
    if (!current) return;
    current.ctl.abort();
    await current.done;
  }

  function labels() {
    if (state.status === 'blocked') {
      // fmkorea's security check is up: more requests only make it worse. The user reloads instead.
      state.finished = false;
      state.moreLabel = null;
      return;
    }
    const open = jobs.map((_, i) => i).filter((i) => fetched[i] < last[i]);
    state.finished = unfinished.length === 0 && open.length === 0;
    state.moreLabel = unfinished.length ? '이어서 검색' : open.length ? '더 보기' : null;
  }

  async function run(indices, my) {
    await stopCurrent();
    if (my !== token) return; // superseded while waiting for the previous run to stop
    const ctl = new AbortController();
    const runJobs = indices.map((i) => ({ ...jobs[i], page: fetched[i] + 1, index: i }));
    const settled = new Set();
    const rowsBefore = state.rows.length;
    Object.assign(state, { status: 'running', notice: null, moreLabel: null, progress: { done: 0, total: runJobs.length } });
    emit();

    const done = runSearch({
      jobs: runJobs,
      fetchPage,
      take,
      ...(sleep ? { sleep } : {}),
      signal: ctl.signal,
      onResult: (job, page) => {
        if (my !== token) return;
        fetched[job.index] = job.page;
        last[job.index] = page.lastPage;
        const rows = page.items.map(({ row, tr }) => ({ ...row, tr }));
        // a category list page is that category by construction; only search rows need the id check
        const cat = job.kind === 'list' && job.categoryId ? { ...category, ids: [] } : category;
        const kept = filterRows(rows, { category: cat, hiddenBrandIds: sel.hiddenBrandIds, matchers });
        state.rows = mergeRows(state.rows, kept, job.brandId, job.term);
        emit();
      },
      onSettled: (job) => {
        if (my !== token) return;
        settled.add(job.index);
        state.progress = { done: settled.size, total: runJobs.length };
        emit();
      },
    });
    current = { ctl, done: done.catch(() => {}) };
    const res = await done;
    if (current?.ctl === ctl) current = null;
    if (my !== token) return;

    const failedIdx = new Set(res.failed.map((f) => f.job.index));
    unfinished = runJobs.map((j) => j.index).filter((i) => failedIdx.has(i) || fetched[i] < runJobs.find((j) => j.index === i).page);
    const reasons = new Set(res.failed.map((f) => f.reason));
    if (res.status === 'done') {
      emptyRounds = state.rows.length > rowsBefore ? 0 : emptyRounds + 1;
      state.autoLoad = emptyRounds < MAX_EMPTY_ROUNDS;
    }
    Object.assign(state, {
      status: res.status,
      progress: null,
      notice: NOTICE_ORDER.find((r) => reasons.has(r)) ?? null,
    });
    labels();
    emit();
  }

  return {
    state,
    /** @param {{ brandIds: string[], categoryKey: string, hiddenBrandIds: string[] }} s */
    async start(s) {
      const my = ++token;
      sel = s;
      category = dict.categories.find((c) => c.key === s.categoryKey) ?? dict.categories.find((c) => c.key === 'all');
      await stopCurrent();
      if (my !== token) return;
      const browse = s.brandIds.length === 0 && s.hiddenBrandIds.length > 0;
      const built = browse
        ? { jobs: buildListJobs({ dict, categoryKey: s.categoryKey }), totalTerms: 0 }
        : buildSearchJobs({ dict, selectedBrandIds: s.brandIds, hiddenBrandIds: s.hiddenBrandIds });
      jobs = built.jobs;
      state.mode = browse ? 'browse' : s.brandIds.length ? 'search' : null;
      fetched = jobs.map(() => 0);
      last = jobs.map(() => Infinity);
      unfinished = [];
      emptyRounds = 0;
      Object.assign(state, {
        autoLoad: true,
        rows: [], progress: null, notice: null, moreLabel: null, finished: false,
        totalTerms: built.totalTerms, jobCount: jobs.length,
      });
      if (!jobs.length) {
        state.status = 'empty';
        emit();
        return;
      }
      await run(jobs.map((_, i) => i), my);
    },
    async more() {
      if (state.status === 'running' || !state.moreLabel) return;
      const indices = unfinished.length ? unfinished : jobs.map((_, i) => i).filter((i) => fetched[i] < last[i]);
      unfinished = [];
      await run(indices, ++token);
    },
    cancel() {
      current?.ctl.abort();
    },
    get category() {
      return category;
    },
  };
}
