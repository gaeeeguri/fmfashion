// Virtual time for crawl tests: sleep(ms) jumps the clock forward instead of waiting.
// Concurrent sleepers wake in deadline order.
export function fakeClock(start = 0) {
  let t = start;
  const sleepers = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    // let every pending task register its sleep before advancing
    for (;;) {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      if (!sleepers.length) break;
      sleepers.sort((a, b) => a.at - b.at);
      const s = sleepers.shift();
      t = Math.max(t, s.at);
      s.resolve();
    }
    draining = false;
  }
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleep(ms) {
      return new Promise((resolve) => {
        sleepers.push({ at: t + Math.max(0, ms), resolve });
        drain();
      });
    },
  };
}
