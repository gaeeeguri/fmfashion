// One rate limit shared by every fmkorea request (list + post). Measured safe: 2 req/s with no 429.
// A 429 pauses everything; repeated 429s step the rate down. (spec §4.2)

/**
 * @param {{ rates?: number[], maxInFlight?: number, pauseMs?: number, windowMs?: number, threshold?: number,
 *   clock: { now: () => number, sleep: (ms: number) => Promise<void> },
 *   initial?: { rateIndex: number, recent429s: number[] } }} o
 */
export function createRateGate({
  rates = [2, 1.5, 1],
  maxInFlight = 4,
  pauseMs = 300000,
  windowMs = 3600000,
  threshold = 3,
  clock,
  initial,
}) {
  let rateIndex = initial?.rateIndex ?? 0;
  let recent429s = [...(initial?.recent429s ?? [])];
  let inFlight = 0;
  let nextAt = -Infinity; // earliest start time of the next request
  let pausedUntil = -Infinity;
  const waiters = [];
  const wake = () => waiters.shift()?.();

  return {
    get rate() {
      return rates[rateIndex];
    },
    async acquire() {
      for (;;) {
        while (inFlight >= maxInFlight) await new Promise((r) => waiters.push(r));
        const t = clock.now();
        if (t < pausedUntil) {
          await clock.sleep(pausedUntil - t);
          continue;
        }
        // reserve the slot synchronously so concurrent callers queue behind each other
        const at = Math.max(t, nextAt);
        nextAt = at + 1000 / rates[rateIndex];
        inFlight++;
        if (at > t) await clock.sleep(at - t);
        if (clock.now() < pausedUntil) {
          inFlight--;
          wake();
          continue;
        }
        return;
      }
    },
    release() {
      inFlight = Math.max(0, inFlight - 1);
      wake();
    },
    on429() {
      const t = clock.now();
      pausedUntil = Math.max(pausedUntil, t + pauseMs);
      recent429s = recent429s.filter((x) => t - x < windowMs);
      recent429s.push(t);
      let lowered = false;
      if (recent429s.length >= threshold && rateIndex < rates.length - 1) {
        rateIndex++;
        recent429s = [];
        lowered = true;
      }
      return { pausedUntil, rate: rates[rateIndex], lowered };
    },
    snapshot: () => ({ rateIndex, recent429s: [...recent429s] }),
  };
}
