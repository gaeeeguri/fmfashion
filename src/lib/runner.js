import { buildSearchUrl } from './query.js';
import { parseListHtml, isBlockedHtml } from './parser.js';

export const MIN_DELAY_MS = 1000;
export const JITTER_MS = 500;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs search jobs strictly one at a time, with a polite delay between requests.
 * @param {{
 *   jobs: import('./query.js').SearchJob[], page?: number, categoryId?: string,
 *   fetchPage: (url: string, signal?: AbortSignal) => Promise<{ status: number, html: string }>,
 *   sleep?: (ms: number) => Promise<void>, random?: () => number, signal?: AbortSignal,
 *   onProgress?: (p: { done: number, total: number, term: string }) => void,
 *   onRows: (rows: import('./parser.js').Row[], job: import('./query.js').SearchJob) => void,
 * }} opts
 * @returns {Promise<{ status: 'done' | 'blocked' | 'cancelled' | 'error', completed: number }>}
 */
export async function runSearch({
  jobs, page = 1, categoryId, fetchPage, sleep = defaultSleep, random = Math.random, signal, onProgress, onRows,
}) {
  let completed = 0;
  for (const [i, job] of jobs.entries()) {
    if (signal?.aborted) return { status: 'cancelled', completed };
    if (i > 0) {
      await sleep(MIN_DELAY_MS + Math.floor(random() * JITTER_MS));
      if (signal?.aborted) return { status: 'cancelled', completed };
    }
    onProgress?.({ done: i, total: jobs.length, term: job.term });
    let res;
    try {
      res = await fetchPage(buildSearchUrl(job.keyword, page, categoryId), signal);
    } catch {
      return { status: signal?.aborted ? 'cancelled' : 'error', completed };
    }
    if (res.status === 430 || isBlockedHtml(res.html)) return { status: 'blocked', completed };
    if (res.status >= 400) return { status: 'error', completed };
    onRows(parseListHtml(res.html), job);
    completed++;
  }
  return { status: 'done', completed };
}
