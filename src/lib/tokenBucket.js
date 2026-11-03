const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * Client-side pacing for fmkorea requests (spec §5.4): a burst of `capacity` requests goes out at
 * once, then `refillPerSec` per second. Waiters are served first-come first-served.
 * With a `store`, the bucket state outlives the page: every fmkorea page view and tab shares one budget
 * (opening posts from the results must not reset it).
 * @param {{ capacity?: number, refillPerSec?: number, now?: () => number,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   store?: { load: () => { tokens: number, last: number } | null, save: (v: { tokens: number, last: number }) => void } }} [opts]
 * @returns {{ take: (signal?: AbortSignal) => Promise<void> }}
 */
export function createTokenBucket({ capacity = 15, refillPerSec = 2, now = Date.now, sleep = defaultSleep, store } = {}) {
  let tokens = capacity;
  let last = now();
  let tail = Promise.resolve();

  const load = () => {
    try {
      const v = store?.load();
      if (v && Number.isFinite(v.tokens) && Number.isFinite(v.last) && v.last <= now()) {
        tokens = Math.min(capacity, Math.max(0, v.tokens));
        last = v.last;
      }
    } catch {
      /* storage unavailable: keep the in-memory state */
    }
  };
  const persist = () => {
    try {
      store?.save({ tokens, last });
    } catch {
      /* ignore */
    }
  };

  const refill = () => {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
    last = t;
  };

  async function acquire(signal) {
    for (;;) {
      if (signal?.aborted) throw abortError();
      load();
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        persist();
        return;
      }
      await sleep(Math.ceil(((1 - tokens) / refillPerSec) * 1000), signal);
    }
  }

  return {
    take(signal) {
      const p = tail.then(() => acquire(signal));
      tail = p.catch(() => {});
      return p;
    },
  };
}
