const UNIT = { s: 1000, m: 60000, h: 3600000 };

/**
 * @param {string[]} argv
 * @param {number} now
 * @returns {{ runUntil: number|null, deadline: number|null, target: number, probeDepth: number|null, interval: number|null }}
 */
export function parseArgs(argv, now) {
  const out = { runUntil: null, deadline: null, target: 100000, probeDepth: null, interval: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === '--for') {
      const m = /^(\d+(?:\.\d+)?)([smh])$/.exec(val ?? '');
      if (!m) throw new Error(`--for needs a duration like 1h or 30m, got ${val}`);
      out.runUntil = now + Number(m[1]) * UNIT[m[2]];
    } else if (flag === '--until') {
      const t = Date.parse(val ?? '');
      if (Number.isNaN(t)) throw new Error(`--until needs an ISO time like 2026-11-05T09:40:00+09:00, got ${val}`);
      out.deadline = t;
    } else if (flag === '--target' || flag === '--probe-depth') {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer, got ${val}`);
      if (flag === '--target') out.target = n;
      else out.probeDepth = n;
    } else if (flag === '--interval') {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--interval needs seconds between requests (> 0), got ${val}`);
      out.interval = n;
    } else {
      throw new Error(`unknown option ${flag}`);
    }
    i++;
  }
  return out;
}
