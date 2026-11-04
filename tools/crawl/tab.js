// fmfashion crawl — Arc tab side. Paste into the DevTools console of a https://www.fmkorea.com/fashion tab
// while `npm run crawl` is running. It only performs the fetches the crawler asks for (same-origin, your session).
// Pacing, saving and resume all live in the crawler. Re-paste after reloading the tab.
(() => {
  const BRIDGE = 'http://127.0.0.1:47823';
  const WORKERS = 4;
  const TIMEOUT_MS = 20000;
  if (window.fmfTab?.running) return console.warn('[fmf] already running — fmfTab.stop() first');

  const badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:8px;' +
    'font:12px/1.4 system-ui;background:#111;color:#fff;opacity:.85;pointer-events:none';
  document.body.append(badge);
  let done = 0;
  let state = '연결 중…';
  const show = () => (badge.textContent = `fmf 수집 탭 · ${state} · 처리 ${done}건 (이 탭을 닫지 마세요)`);
  show();

  const api = { running: true, stop: () => (api.running = false) };
  window.fmfTab = api;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function worker() {
    let backoff = 1000;
    while (api.running) {
      let job;
      try {
        const r = await fetch(`${BRIDGE}/next`, { cache: 'no-store' });
        if (r.status === 204) continue;
        job = await r.json();
        backoff = 1000;
        state = '연결됨';
      } catch {
        state = '수집기에 연결 안 됨 — 재시도 중';
        show();
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
        continue;
      }
      let result;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(job.url, { credentials: 'include', cache: 'no-store', signal: ctl.signal });
        result = { status: res.status, html: await res.text() };
      } catch (e) {
        result = { error: e.name === 'AbortError' ? 'timeout' : 'network' };
      } finally {
        clearTimeout(t);
      }
      try {
        await fetch(`${BRIDGE}/result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: job.id, ...result }),
        });
      } catch {}
      done++;
      show();
    }
  }
  Promise.all(Array.from({ length: WORKERS }, worker)).then(() => {
    api.running = false;
    badge.remove();
  });
  console.log('[fmf] tab bridge started — leave this tab open');
})();
