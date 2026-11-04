// Resumable crawl loop (spec §4.2–4.6). Browser-free: fetch, clock and store are injected.
import { parseList, parsePost, classify } from './parse.js';
import { createRateGate } from './rateGate.js';

const listUrl = (category, page) => `/index.php?mid=fashion${category ? `&category=${category}` : ''}&page=${page}`;

/**
 * @param {{
 *   fetchPage: (url: string) => Promise<{status: number, html: string} | {error: 'network'|'timeout'}>,
 *   waitForNetwork: () => Promise<void>,
 *   store: ReturnType<typeof import('./store.js').openStore>,
 *   clock: { now: () => number, sleep: (ms: number) => Promise<void> },
 *   opts: { sources: Array<{category: string|null}>, excludeCategoryIds: string[], target: number,
 *     deadline: number|null, runUntil: number|null, checkpoints: number[], refillBelow: number,
 *     unrecognizedStreakLimit: number, maxInFlight?: number, interrupted?: boolean },
 *   onCheckpoint: (label: number|string, postCount: number) => void,
 *   log?: (msg: string) => void,
 * }} deps
 * @returns {Promise<{ reason: 'interrupted'|'target'|'deadline'|'for'|'blocked'|'unrecognized-streak'|'exhausted', postCount: number }>}
 */
export async function runCrawl({ fetchPage, waitForNetwork, store, clock, opts, onCheckpoint, log = () => {} }) {
  const prev = store.readState();
  const maxInFlight = opts.maxInFlight ?? 4;
  // source order always comes from opts (priority may change after the pilot); progress per category is kept
  const sources = opts.sources.map(({ category }) => {
    const old = prev?.sources?.find((s) => s.category === category);
    return { category, nextPage: old?.nextPage ?? 1, lastPage: old?.lastPage ?? null };
  });
  const state = {
    sources,
    sourceIndex: 0,
    queue: (prev?.queue ?? []).filter((r) => !store.doneIds.has(r.docId)),
    rateIndex: prev?.rateIndex ?? 0,
    recent429s: prev?.recent429s ?? [],
    firedCheckpoints: prev?.firedCheckpoints ?? [],
    stopReason: null,
    startedAt: prev?.startedAt ?? clock.now(),
    updatedAt: clock.now(),
  };
  const gate = createRateGate({ clock, maxInFlight, initial: { rateIndex: state.rateIndex, recent429s: state.recent429s } });
  const queued = new Set(state.queue.map((r) => r.docId));
  const taken = new Set(); // rows being fetched right now
  let pending = []; // bodiless rows waiting to see whether this is a streak (spec §4.2)
  let stop = null;

  const save = () => {
    Object.assign(state, gate.snapshot(), { updatedAt: clock.now() });
    store.writeState(state);
  };
  const checkStop = () => {
    if (stop) return stop;
    if (opts.interrupted) return (stop = 'interrupted');
    if (store.postCount() >= opts.target) return (stop = 'target');
    if (opts.deadline != null && clock.now() >= opts.deadline) return (stop = 'deadline');
    if (opts.runUntil != null && clock.now() >= opts.runUntil) return (stop = 'for');
    return null;
  };
  const checkCheckpoints = () => {
    const n = store.postCount();
    for (const c of opts.checkpoints) {
      if (n >= c && !state.firedCheckpoints.includes(c)) {
        state.firedCheckpoints.push(c);
        save();
        onCheckpoint(c, n);
      }
    }
  };
  const finish = (row) => {
    const i = state.queue.findIndex((r) => r.docId === row.docId);
    if (i >= 0) state.queue.splice(i, 1);
    queued.delete(row.docId);
    taken.delete(row.docId);
  };
  const meta = (row) => ({ docId: row.docId, categoryId: row.categoryId, categoryName: row.categoryName, title: row.title });

  /** One request through the shared gate; network errors and 429s are retried here. */
  async function request(kind, url) {
    for (;;) {
      if (checkStop()) return { cls: 'stopped' };
      await gate.acquire();
      if (checkStop()) {
        gate.release();
        return { cls: 'stopped' };
      }
      const t0 = clock.now();
      let res;
      try {
        res = await fetchPage(url);
      } finally {
        gate.release();
      }
      const cls = classify(res);
      store.appendRequest({ t: clock.now(), kind, status: 'error' in res ? res.error : res.status, ms: clock.now() - t0 });
      save();
      if (cls === 'network') {
        log(`network ${'error' in res ? res.error : ''} — waiting for connection (${url})`);
        await waitForNetwork();
        continue;
      }
      if (cls === 'rate-limited') {
        const r = gate.on429();
        log(`429 on ${url} — pausing until ${new Date(r.pausedUntil).toISOString()}${r.lowered ? `, rate lowered to ${r.rate}/s` : ''}`);
        save();
        continue;
      }
      return { cls, res };
    }
  }

  function hasMorePages() {
    while (state.sourceIndex < state.sources.length) {
      const s = state.sources[state.sourceIndex];
      if (s.lastPage == null || s.nextPage <= s.lastPage) return true;
      state.sourceIndex++;
    }
    return false;
  }

  async function fetchList() {
    const src = state.sources[state.sourceIndex];
    const { cls, res } = await request('list', listUrl(src.category, src.nextPage));
    if (cls === 'stopped') return;
    if (cls === 'blocked') {
      stop = 'blocked';
      return;
    }
    if (cls === 'http-error') {
      log(`list page ${src.nextPage} → HTTP ${res.status}, skipping`);
      src.nextPage++;
      save();
      return;
    }
    const { rows, lastPage } = parseList(res.html, opts.excludeCategoryIds);
    if (lastPage != null) src.lastPage = lastPage;
    else if (rows.length === 0) src.lastPage = src.nextPage; // empty page without a pager: treat as the end
    for (const r of rows) {
      if (store.doneIds.has(r.docId) || queued.has(r.docId)) continue;
      queued.add(r.docId);
      state.queue.push(r);
    }
    src.nextPage++;
    save();
  }

  async function fetchPost(row) {
    const { cls, res } = await request('post', `/${row.docId}`);
    if (cls === 'stopped') {
      taken.delete(row.docId);
      return;
    }
    if (cls === 'blocked') {
      taken.delete(row.docId);
      stop = 'blocked';
      return;
    }
    const fetchedAt = clock.now();
    if (cls === 'http-error') {
      store.appendPost({ ...meta(row), date: null, text: '', imgCount: 0, status: res.status, fetchedAt, unrecognized: true });
      finish(row);
    } else {
      const body = parsePost(res.html);
      if (!body) {
        store.appendUnrecognized({ docId: row.docId, status: res.status, at: fetchedAt });
        taken.delete(row.docId);
        pending.push(row);
        if (pending.length >= opts.unrecognizedStreakLimit) stop = 'unrecognized-streak';
      } else {
        // a good page ends the streak: the earlier bodiless ones were sporadic (deleted posts etc.)
        for (const p of pending) {
          store.appendPost({ ...meta(p), date: null, text: '', imgCount: 0, status: 200, fetchedAt, unrecognized: true });
          finish(p);
        }
        pending = [];
        store.appendPost({ ...meta(row), ...body, status: res.status, fetchedAt });
        finish(row);
        const n = store.postCount();
        if (n % 100 === 0) log(`${n} posts · ${gate.rate}/s · queue ${state.queue.length}`);
      }
    }
    save();
    checkCheckpoints();
  }

  save();
  checkCheckpoints();
  const active = new Set();
  const isPending = (id) => pending.some((p) => p.docId === id);
  const pickable = () => state.queue.filter((r) => !taken.has(r.docId) && !isPending(r.docId));

  while (!checkStop()) {
    const ready = pickable();
    if (ready.length < opts.refillBelow && hasMorePages()) {
      await fetchList();
      continue;
    }
    if (ready.length === 0) {
      if (active.size) {
        await Promise.race(active);
        continue;
      }
      stop = 'exhausted';
      break;
    }
    if (active.size >= maxInFlight) {
      await Promise.race(active);
      continue;
    }
    const row = ready[0];
    taken.add(row.docId);
    const p = fetchPost(row).finally(() => active.delete(p));
    active.add(p);
  }
  await Promise.all(active);

  state.stopReason = stop;
  save();
  const count = store.postCount();
  if (stop === 'interrupted') {
    // Ctrl-C / SIGTERM: state is saved, no report; rerun resumes
  } else if (stop === 'for') onCheckpoint('pilot', count);
  else if (!(stop === 'target' && opts.checkpoints.includes(opts.target))) onCheckpoint('final', count);
  log(`stopped: ${stop} · ${count} posts`);
  return { reason: stop, postCount: count };
}
