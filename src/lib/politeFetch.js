/**
 * Wraps a fetchPage so every caller shares one queue: at most one request in flight,
 * and request starts are at least `minGapMs` apart — even across separate search runs.
 * @param {(url: string, signal?: AbortSignal) => Promise<{ status: number, html: string }>} fetchPage
 * @param {{ minGapMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createPoliteFetch(fetchPage, { minGapMs = 1000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let tail = Promise.resolve();
  let lastStart = -Infinity;
  return (url, signal) => {
    const run = async () => {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastStart = now();
      return fetchPage(url, signal);
    };
    const p = tail.then(run, run);
    tail = p.catch(() => {});
    return p;
  };
}
