import { jobUrl } from './query.js';
import { parseSearchPage } from './parser.js';

export const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Sleep that resolves early when `signal` aborts. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** @typedef {import('./query.js').SearchJob & { page: number, index: number }} RunJob */
/** @typedef {{ job: RunJob, reason: 'limited' | 'error' | 'unrecognized' }} JobFailure */

/**
 * Runs every job at once; each request (retries included) first takes a token from the shared bucket.
 * 429 → that job alone retries after `retryDelays`; 430 / security page → the whole run is aborted.
 * @param {{
 *   jobs: RunJob[],
 *   fetchPage: (url: string, signal?: AbortSignal) => Promise<{ status: number, html: string }>,
 *   take: (signal?: AbortSignal) => Promise<void>,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, retryDelays?: number[], signal?: AbortSignal,
 *   onResult: (job: RunJob, page: { items: Array<{ row: import('./parser.js').Row, tr: HTMLTableRowElement }>, lastPage: number }) => void,
 *   onSettled?: (job: RunJob) => void,
 * }} opts
 * @returns {Promise<{ status: 'done' | 'blocked' | 'cancelled', failed: JobFailure[] }>}
 */
export async function runSearch({
  jobs, fetchPage, take, sleep = abortableSleep, retryDelays = RETRY_DELAYS_MS, signal, onResult, onSettled,
}) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  let blocked = false;
  /** @type {JobFailure[]} */
  const failed = [];

  async function one(job) {
    const url = jobUrl(job, job.page);
    for (let attempt = 0; ; attempt++) {
      if (ctl.signal.aborted) return;
      let res;
      try {
        await take(ctl.signal);
        res = await fetchPage(url, ctl.signal);
      } catch {
        if (!ctl.signal.aborted) failed.push({ job, reason: 'error' });
        return;
      }
      if (ctl.signal.aborted) return;
      if (res.status === 429) {
        if (attempt >= retryDelays.length) {
          failed.push({ job, reason: 'limited' });
          return;
        }
        await sleep(retryDelays[attempt], ctl.signal);
        continue;
      }
      const page = res.status === 430 ? { kind: 'blocked' } : parseSearchPage(res.html);
      if (page.kind === 'blocked') {
        blocked = true;
        ctl.abort();
        return;
      }
      if (res.status >= 400) failed.push({ job, reason: 'error' });
      else if (page.kind === 'unrecognized') failed.push({ job, reason: 'unrecognized' });
      else onResult(job, { items: page.items, lastPage: page.lastPage });
      return;
    }
  }

  await Promise.all(
    jobs.map((job) =>
      one(job).finally(() => {
        if (!ctl.signal.aborted) onSettled?.(job);
      }),
    ),
  );
  signal?.removeEventListener('abort', onAbort);
  if (blocked) return { status: 'blocked', failed };
  if (signal?.aborted) return { status: 'cancelled', failed };
  return { status: 'done', failed };
}
