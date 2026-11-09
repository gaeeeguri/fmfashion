// Local bridge between the crawler (Node) and the user's Arc tab on fmkorea.
// The tab long-polls GET /next for a URL, fetches it same-origin with the user's session, and POSTs /result.
// Pacing, storage and resume stay in Node; the tab only performs fetches (spec §4.1, user choice A).
import http from 'node:http';

const ALLOWED_ORIGIN = 'https://www.fmkorea.com';

/**
 * @param {{ port?: number, log: (msg: string) => void, jobTimeoutMs?: number, pollTimeoutMs?: number }} o
 */
export async function openBridge({ port = 47823, log, jobTimeoutMs = 30000, pollTimeoutMs = 25000 }) {
  let nextId = 1;
  const queued = []; // jobs waiting for a poller
  const jobs = new Map(); // id → { url, resolve, timer }
  const pollers = []; // pending long-poll responses
  let tabWaiters = [];
  let lastPollAt = 0;
  let connected = false;

  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== ALLOWED_ORIGIN) {
      res.writeHead(403).end();
      return false;
    }
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-private-network', 'true');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
    }
    return true;
  };
  const sendJob = (res, job) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: job.id, url: job.url }));
  };
  const finish = (id, value) => {
    const job = jobs.get(id);
    if (!job) return; // late answer for a job that already timed out
    jobs.delete(id);
    clearTimeout(job.timer);
    job.resolve(value);
  };

  const server = http.createServer((req, res) => {
    if (!cors(req, res)) return;
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const path = new URL(req.url, 'http://x').pathname;

    if (req.method === 'GET' && path === '/next') {
      lastPollAt = Date.now();
      if (!connected) {
        connected = true;
        log('Arc tab connected');
      }
      for (const w of tabWaiters) w();
      tabWaiters = [];
      const job = queued.shift();
      if (job) return sendJob(res, job);
      const poller = { res, timer: setTimeout(() => {
        pollers.splice(pollers.indexOf(poller), 1);
        res.writeHead(204).end();
      }, pollTimeoutMs) };
      pollers.push(poller);
      res.on('close', () => {
        const i = pollers.indexOf(poller);
        if (i >= 0) {
          clearTimeout(poller.timer);
          pollers.splice(i, 1);
        }
      });
      return;
    }
    if (req.method === 'POST' && path === '/result') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { id, status, html, error } = JSON.parse(body);
          finish(id, error ? { error: error === 'timeout' ? 'timeout' : 'network' } : { status, html: html ?? '' });
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  /** @returns {Promise<{status: number, html: string} | {error: 'network'|'timeout'}>} */
  function fetchPage(target) {
    return new Promise((resolve) => {
      const job = { id: nextId++, url: target, resolve };
      job.timer = setTimeout(() => {
        const i = queued.indexOf(job);
        if (i >= 0) queued.splice(i, 1);
        finish(job.id, { error: 'timeout' });
      }, jobTimeoutMs);
      jobs.set(job.id, job);
      const poller = pollers.shift();
      if (poller) {
        clearTimeout(poller.timer);
        sendJob(poller.res, job);
      } else queued.push(job);
    });
  }

  /** Resolves when the tab is polling again (it was closed, asleep, or offline). */
  function waitForNetwork() {
    if (pollers.length || Date.now() - lastPollAt < 2000) return Promise.resolve();
    if (connected) {
      connected = false;
      log('Arc tab not polling — waiting for it (keep the fmkorea tab open; re-paste the tab script if it was reloaded)');
    }
    return new Promise((resolve) => tabWaiters.push(resolve));
  }

  async function close() {
    for (const p of pollers.splice(0)) {
      clearTimeout(p.timer);
      p.res.writeHead(204).end();
    }
    for (const id of [...jobs.keys()]) finish(id, { error: 'network' });
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }

  return { url, fetchPage, waitForNetwork, close };
}
