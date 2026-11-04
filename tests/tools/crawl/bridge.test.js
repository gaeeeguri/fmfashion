import { test, expect, afterEach } from 'vitest';
import { openBridge } from '../../../tools/crawl/bridge.js';

let bridge;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});
const open = (o = {}) => openBridge({ port: 0, log: () => {}, ...o });

/** A fake Arc tab: polls the bridge and answers jobs with `answer(url)`. */
function fakeTab(base, answer, { polls = Infinity } = {}) {
  let stopped = false;
  (async () => {
    for (let i = 0; i < polls && !stopped; i++) {
      const r = await fetch(`${base}/next`).catch(() => null);
      if (!r || r.status === 204) continue;
      const job = await r.json();
      const res = await answer(job.url);
      await fetch(`${base}/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, ...res }) });
    }
  })();
  return () => (stopped = true);
}

test('fetchPage is answered by the tab', async () => {
  bridge = await open();
  const stop = fakeTab(bridge.url, async (url) => ({ status: 200, html: `<p>${url}</p>` }));
  await expect(bridge.fetchPage('/123')).resolves.toEqual({ status: 200, html: '<p>/123</p>' });
  stop();
});

test('a tab-side fetch failure comes back as a network error', async () => {
  bridge = await open();
  const stop = fakeTab(bridge.url, async () => ({ error: 'network' }));
  await expect(bridge.fetchPage('/1')).resolves.toEqual({ error: 'network' });
  stop();
});

test('no answer within the job timeout is a timeout', async () => {
  bridge = await open({ jobTimeoutMs: 200 });
  await expect(bridge.fetchPage('/1')).resolves.toEqual({ error: 'timeout' });
});

test('waitForNetwork resolves once a tab is polling', async () => {
  bridge = await open({ pollTimeoutMs: 100 });
  let done = false;
  const w = bridge.waitForNetwork().then(() => (done = true));
  await new Promise((r) => setTimeout(r, 150));
  expect(done).toBe(false);
  const stop = fakeTab(bridge.url, async () => ({ status: 200, html: '' }));
  await w;
  expect(done).toBe(true);
  stop();
});

test('preflight from fmkorea allows the private-network request', async () => {
  bridge = await open();
  const r = await fetch(`${bridge.url}/next`, {
    method: 'OPTIONS',
    headers: { origin: 'https://www.fmkorea.com', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
  });
  expect(r.status).toBe(204);
  expect(r.headers.get('access-control-allow-origin')).toBe('https://www.fmkorea.com');
  expect(r.headers.get('access-control-allow-private-network')).toBe('true');
});

test('other origins are refused', async () => {
  bridge = await open();
  const r = await fetch(`${bridge.url}/next`, { headers: { origin: 'https://evil.example' } });
  expect(r.status).toBe(403);
});
