import { test, expect } from 'vitest';
import { createPoliteFetch } from '../../src/lib/politeFetch.js';

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('serializes concurrent callers and keeps a minimum gap between request starts', async () => {
  const c = clock();
  const starts = [];
  let inflight = 0;
  let maxInflight = 0;
  const raw = async (url) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    starts.push([url, c.now()]);
    await c.sleep(200); // request takes 200ms
    inflight--;
    return { status: 200, html: url };
  };
  const polite = createPoliteFetch(raw, { minGapMs: 1000, now: c.now, sleep: c.sleep });
  const results = await Promise.all([polite('a'), polite('b'), polite('c')]);
  expect(results.map((r) => r.html)).toEqual(['a', 'b', 'c']);
  expect(maxInflight).toBe(1);
  for (let i = 1; i < starts.length; i++) expect(starts[i][1] - starts[i - 1][1]).toBeGreaterThanOrEqual(1000);
});
test('a failed request does not jam the queue', async () => {
  const c = clock();
  let n = 0;
  const raw = async () => { if (++n === 1) throw new Error('net'); return { status: 200, html: 'ok' }; };
  const polite = createPoliteFetch(raw, { minGapMs: 1000, now: c.now, sleep: c.sleep });
  await expect(polite('a')).rejects.toThrow('net');
  expect((await polite('b')).html).toBe('ok');
});
