// @vitest-environment jsdom
import { expect } from 'vitest';
import { fixture, ftest } from './fixtures.js';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { createSearchSession } from '../../src/lib/searchSession.js';

const LIST = fixture('search-result.html');
const BOARD = fixture('board-list.html');
const matchers = compileMatchers(bundled);
const terms = (id) => bundled.brands.find((b) => b.id === id).searchTerms;

/** respond(params, signal) → response; default serves LIST */
function fakeFetch(respond) {
  const calls = [];
  const signals = [];
  const fetchPage = async (url, signal) => {
    const p = new URL(url).searchParams;
    calls.push(p);
    signals.push(signal);
    await new Promise((r) => setTimeout(r, 1));
    return (respond && (await respond(p, signal))) ?? { status: 200, html: LIST };
  };
  return { fetchPage, calls, signals };
}
const make = (f, dict = bundled) =>
  createSearchSession({
    dict, matchers: compileMatchers(dict), fetchPage: f.fetchPage, take: async () => {}, sleep: async () => {},
  });
const sel = (brandIds, categoryKey = 'all', hiddenBrandIds = []) => ({ brandIds, categoryKey, hiddenBrandIds });

ftest('start merges and dedups newest first', async () => {
  const s = make(fakeFetch());
  await s.start(sel(['steadyeverywhere', 'anotheroffice']));
  const { state } = s;
  expect(state.status).toBe('done');
  expect(state.jobCount).toBe(terms('steadyeverywhere').length + terms('anotheroffice').length);
  const ids = state.rows.map((r) => r.docId);
  expect(ids).toEqual([...ids].sort((a, b) => b - a));
  expect(new Set(ids).size).toBe(ids.length);
  expect(state.rows.every((r) => r.tr?.tagName === 'TR' && r.hits.length === state.jobCount)).toBe(true);
  expect(state.progress).toBeNull();
});
ftest('category filter applies', async () => {
  const s = make(fakeFetch());
  await s.start(sel(['anotheroffice'], 'fit'));
  const fit = bundled.categories.find((c) => c.key === 'fit').ids;
  expect(s.state.rows.length).toBeGreaterThan(0);
  expect(s.state.rows.every((r) => fit.includes(r.categoryId))).toBe(true);
});
ftest('rows matching hidden brands are dropped', async () => {
  const html = LIST.replace('오늘 착샷', '파프터 오늘 착샷');
  const s = make(fakeFetch(() => ({ status: 200, html })));
  await s.start(sel(['anotheroffice'], 'all', ['fafter']));
  expect(s.state.rows.length).toBeGreaterThan(0);
  expect(s.state.rows.some((r) => r.docId === 10501045295)).toBe(false);
});
ftest('more() stops at data-last-page', async () => {
  const f = fakeFetch();
  const s = make(f);
  await s.start(sel(['anotheroffice']));
  expect(s.state.moreLabel).toBe('더 보기');
  expect(s.state.finished).toBe(false);
  const before = f.calls.length;
  await s.more();
  expect(f.calls.slice(before).map((p) => p.get('page'))).toEqual(['2', '2']);
  expect(s.state.moreLabel).toBeNull();
  expect(s.state.finished).toBe(true);
  const n = f.calls.length;
  await s.more();
  expect(f.calls.length).toBe(n);
});
ftest('limited job → 이어서 검색, more() refetches only it', async () => {
  const first = terms('anotheroffice')[0];
  let limit = true;
  const f = fakeFetch((p) => (limit && p.get('search_keyword') === first ? { status: 429, html: '' } : undefined));
  const s = make(f);
  await s.start(sel(['anotheroffice']));
  expect(s.state.status).toBe('done');
  expect(s.state.notice).toBe('limited');
  expect(s.state.moreLabel).toBe('이어서 검색');
  expect(s.state.rows.length).toBeGreaterThan(0);
  limit = false;
  const before = f.calls.length;
  await s.more();
  expect(f.calls.slice(before).map((p) => [p.get('search_keyword'), p.get('page')])).toEqual([[first, '1']]);
  expect(s.state.notice).toBeNull();
  expect(s.state.moreLabel).toBe('더 보기');
});
ftest('blocked keeps rows but offers no resume (user must reload)', async () => {
  const [a, b] = terms('anotheroffice');
  const f = fakeFetch((p) =>
    p.get('search_keyword') === b ? new Promise((r) => setTimeout(() => r({ status: 430, html: '' }), 10)) : undefined,
  );
  const s = make(f);
  await s.start(sel(['anotheroffice']));
  expect(s.state.status).toBe('blocked');
  expect(s.state.rows.length).toBeGreaterThan(0);
  expect(s.state.moreLabel).toBeNull();
  expect(s.state.finished).toBe(false);
  const before = f.calls.length;
  await s.more();
  expect(f.calls.length).toBe(before);
  expect(a && b).toBeTruthy();
});
ftest('new start ignores late results of previous run', async () => {
  const slow = (p, signal) =>
    p.get('search_keyword') === terms('steadyeverywhere')[0]
      ? new Promise((r, rej) => {
          const t = setTimeout(() => r({ status: 200, html: LIST }), 20);
          signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
        })
      : undefined;
  const f = fakeFetch(slow);
  const s = make(f);
  const first = s.start(sel(['steadyeverywhere']));
  await new Promise((r) => setTimeout(r, 5)); // A's requests are in flight
  await s.start(sel(['anotheroffice']));
  await first;
  await new Promise((r) => setTimeout(r, 40));
  const brands = new Set(s.state.rows.flatMap((r) => r.hits.map((h) => h.brandId)));
  expect([...brands]).toEqual(['anotheroffice']);
  expect(f.signals[0].aborted).toBe(true);
  expect(s.state.status).toBe('done');
});
ftest('cancel → cancelled with 이어서 검색', async () => {
  const f = fakeFetch((p, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))));
  const s = make(f);
  const p = s.start(sel(['anotheroffice']));
  await new Promise((r) => setTimeout(r, 5));
  s.cancel();
  await p;
  expect(s.state.status).toBe('cancelled');
  expect(s.state.moreLabel).toBe('이어서 검색');
});
ftest('unrecognized page sets notice', async () => {
  const s = make(fakeFetch(() => ({ status: 200, html: '<html><body>?</body></html>' })));
  await s.start(sel(['anotheroffice']));
  expect(s.state.notice).toBe('unrecognized');
});
ftest('progress counts settled jobs', async () => {
  const seen = [];
  const f = fakeFetch();
  const s = createSearchSession({
    dict: bundled, matchers, fetchPage: f.fetchPage, take: async () => {}, sleep: async () => {},
    onChange: (st) => st.progress && seen.push(`${st.progress.done}/${st.progress.total}`),
  });
  await s.start(sel(['anotheroffice']));
  expect(seen[0]).toBe('0/2');
  expect(seen).toContain('2/2');
});
ftest('no brands and no hidden → empty, no requests', async () => {
  const f = fakeFetch();
  const s = make(f);
  await s.start(sel([]));
  expect(s.state.status).toBe('empty');
  expect(f.calls.length).toBe(0);
});
ftest('alias cap: totalTerms > jobCount', async () => {
  const dict = structuredClone(bundled);
  const b = dict.brands.find((x) => x.id === 'anotheroffice');
  b.searchTerms = Array.from({ length: 35 }, (_, i) => `별명${i}`);
  const s = make(fakeFetch(), dict);
  await s.start(sel(['anotheroffice']));
  expect(s.state.jobCount).toBe(30);
  expect(s.state.totalTerms).toBe(35);
});
ftest('start superseded before its first request sends nothing', async () => {
  const f = fakeFetch();
  const s = make(f);
  const first = s.start(sel(['steadyeverywhere']));
  await s.start(sel(['anotheroffice']));
  await first;
  expect(f.calls.map((p) => p.get('search_keyword').split(' ')[0])).toEqual(terms('anotheroffice'));
});
ftest('category is set synchronously by start()', () => {
  const s = make(fakeFetch());
  const p = s.start(sel(['anotheroffice'], 'fit'));
  expect(s.category.key).toBe('fit');
  return p;
});

const boardFetch = (html = BOARD) => fakeFetch((p) => (p.has('search_keyword') ? undefined : { status: 200, html }));
ftest('browse fit: one list job per id, merged', async () => {
  const f = boardFetch();
  const s = make(f);
  await s.start(sel([], 'fit', ['fafter']));
  const fit = bundled.categories.find((c) => c.key === 'fit').ids;
  expect(s.state.mode).toBe('browse');
  expect(s.state.jobCount).toBe(fit.length);
  expect(f.calls.map((p) => p.get('category')).sort()).toEqual([...fit].sort());
  expect(f.calls.every((p) => !p.has('search_keyword'))).toBe(true);
  const ids = s.state.rows.map((r) => r.docId);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  // a real category page holds only that category; the fixture is the whole board, so only check merging
  expect(s.state.rows.every((r) => r.hits.length === 0)).toBe(true);
  expect(s.state.moreLabel).toBe('더 보기');
});
ftest('browse drops hidden-brand titles', async () => {
  const doc = new DOMParser().parseFromString(BOARD, 'text/html');
  const a = [...doc.querySelectorAll('tr:not(.notice) td.title > a:not(.replyNum)')][3];
  const id = Number(a.getAttribute('href').match(/\d+/)[0]);
  a.textContent = '파프터 CS 또 터짐';
  const s = make(boardFetch(doc.documentElement.outerHTML));
  await s.start(sel([], 'all', ['fafter']));
  expect(s.state.rows.length).toBeGreaterThan(0);
  expect(s.state.rows.some((r) => r.docId === id)).toBe(false);
});
ftest('search mode is labelled', async () => {
  const s = make(fakeFetch());
  await s.start(sel(['anotheroffice']));
  expect(s.state.mode).toBe('search');
});

ftest('auto-load stops after 3 rounds that add nothing new', async () => {
  const deep = LIST.replace(/data-last-page="\d+"/, 'data-last-page="100"');
  const s = make(fakeFetch(() => ({ status: 200, html: deep })));
  await s.start(sel(['anotheroffice']));
  expect(s.state.autoLoad).toBe(true);
  await s.more();
  await s.more();
  expect(s.state.autoLoad).toBe(true);
  await s.more();
  expect(s.state.autoLoad).toBe(false);
  expect(s.state.moreLabel).toBe('더 보기');
  await s.start(sel(['anotheroffice']));
  expect(s.state.autoLoad).toBe(true);
});
ftest('list job rows are kept even without a category link', async () => {
  const html = BOARD.replace(/category=\d+/g, 'x=1');
  const s = make(boardFetch(html));
  await s.start(sel([], 'fit', ['fafter']));
  expect(s.state.rows.length).toBeGreaterThan(0);
});

ftest('snapshot → restore keeps rows and continues paging without refetching', async () => {
  const f = fakeFetch();
  const a = make(f);
  await a.start(sel(['anotheroffice']));
  const snap = JSON.parse(JSON.stringify(a.snapshot()));

  const g = fakeFetch();
  const b = make(g);
  expect(b.restore(snap)).toBe(true);
  expect(g.calls.length).toBe(0);
  expect(b.state.status).toBe('done');
  expect(b.state.rows.map((r) => r.docId)).toEqual(a.state.rows.map((r) => r.docId));
  expect(b.state.rows.map((r) => r.hits)).toEqual(a.state.rows.map((r) => r.hits));
  expect(b.state.rows.every((r) => r.tr?.tagName === 'TR')).toBe(true);
  expect(b.state.moreLabel).toBe('더 보기');
  await b.more();
  expect(g.calls.map((p) => p.get('page'))).toEqual(['2', '2']);
  expect(b.state.finished).toBe(true);
});
ftest('restore rejects a snapshot from different jobs', async () => {
  const a = make(fakeFetch());
  await a.start(sel(['anotheroffice']));
  const snap = a.snapshot();
  const b = make(fakeFetch());
  expect(b.restore({ ...snap, fetched: [1] })).toBe(false);
  expect(b.restore(null)).toBe(false);
});
ftest('rows appear only after every parallel request of the round has settled', async () => {
  const seen = [];
  let s;
  const f = fakeFetch(async () => {
    seen.push({ status: s.state.status, rows: s.state.rows.length });
  });
  s = createSearchSession({
    dict: bundled, matchers, fetchPage: f.fetchPage, take: async () => {}, sleep: async () => {},
    onChange: (st) => seen.push({ status: st.status, rows: st.rows.length }),
  });
  await s.start(sel(['steadyeverywhere']));
  expect(seen.filter((x) => x.status === 'running').every((x) => x.rows === 0)).toBe(true);
  expect(s.state.rows.length).toBeGreaterThan(0);
  const first = s.state.rows.length;
  seen.length = 0;
  await s.more();
  expect(seen.filter((x) => x.status === 'running').every((x) => x.rows === first)).toBe(true);
});
ftest('a round cancelled by the user still adds what it fetched', async () => {
  let s;
  const f = fakeFetch(async (p, signal) => {
    if (p.get('search_keyword') === terms('steadyeverywhere')[0]) return undefined;
    await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  });
  s = make(f);
  const p = s.start(sel(['steadyeverywhere']));
  await new Promise((r) => setTimeout(r, 20));
  s.cancel();
  await p;
  expect(s.state.status).toBe('cancelled');
  expect(s.state.rows.length).toBeGreaterThan(0);
});
ftest('snapshot taken mid-run keeps the last complete round only', async () => {
  let s;
  let snap = null;
  let round = 1;
  let r2calls = 0;
  const f = fakeFetch(async () => {
    // second request of round 2: the first one has already come back by now
    if (round === 2 && ++r2calls === 2) {
      await new Promise((r) => setTimeout(r, 5));
      snap = JSON.parse(JSON.stringify(s.snapshot()));
    }
  });
  s = make(f);
  await s.start(sel(['anotheroffice']));
  const firstIds = s.state.rows.map((r) => r.docId);
  round = 2;
  await s.more();
  const g = fakeFetch();
  const b = make(g);
  expect(b.restore(snap)).toBe(true);
  expect(b.state.rows.map((r) => r.docId)).toEqual(firstIds);
  await b.more();
  expect(g.calls.map((p) => p.get('page'))).toEqual(['2', '2']);
});
