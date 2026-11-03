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
 * @param {{ capacity?: number, refillPerSec?: number, now?: () => number,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} [opts]
 * @returns {{ take: (signal?: AbortSignal) => Promise<void> }}
 */
export function createTokenBucket({ capacity = 15, refillPerSec = 2, now = Date.now, sleep = defaultSleep } = {}) {
  let tokens = capacity;
  let last = now();
  let tail = Promise.resolve();

  const refill = () => {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
    last = t;
  };

  async function acquire(signal) {
    for (;;) {
      if (signal?.aborted) throw abortError();
      refill();
      if (tokens >= 1) {
        tokens -= 1;
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
