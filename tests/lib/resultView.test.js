// @vitest-environment jsdom
import { expect, beforeEach } from 'vitest';
import { fixture, ftest, HAS_FIXTURES } from './fixtures.js';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { parseSearchPage } from '../../src/lib/parser.js';
import { applyHiding } from '../../src/lib/boardPage.js';
import { createResultView } from '../../src/lib/resultView.js';

const BOARD = fixture('board-list.html');
const EMPTY = fixture('search-empty.html');
const matchers = compileMatchers(bundled);
let doc;
let calls;
let handlers;
let obs;
const fakeObserve = () => {
  const o = { cb: null, arms: 0, fire: () => o.cb?.() };
  o.observe = (_el, cb) => { o.cb = cb; o.arms++; return () => { o.cb = null; }; };
  return o;
};
const view = (d = doc) => createResultView(d, handlers, { observe: obs.observe });

const rows = (n = 3) =>
  parseSearchPage(fixture('search-result.html'))
    .items.slice(0, n)
    .map(({ row, tr }, i) => ({ ...row, tr, hits: [{ brandId: 'anotheroffice', term: '목동' }, ...(i === 0 ? [{ brandId: 'steadyeverywhere', term: '스에웨' }] : [])] }));
const ctx = { brands: [{ id: 'steadyeverywhere', name: '스테디에브리웨어' }, { id: 'anotheroffice', name: '어나더오피스' }], categoryName: '착샷', totalTerms: 7, linkHash: '#fmf=b:x;c:all', hiddenCount: 0 };
const st = (o = {}) => ({ status: 'done', mode: 'search', rows: rows(), progress: null, totalTerms: 7, jobCount: 7, notice: null, moreLabel: '더 보기', finished: false, ...o });
const origRows = () => [...doc.querySelectorAll('table.bd_lst tr')].filter((tr) => tr.querySelector('td.title') && !tr.hasAttribute('data-fmf-result'));
const barText = () => doc.getElementById('fmf-results-bar').textContent;

beforeEach(() => {
  if (!HAS_FIXTURES) return;
  doc = new DOMParser().parseFromString(BOARD, 'text/html');
  calls = [];
  obs = fakeObserve();
  handlers = {
    onRemoveBrand: (id) => calls.push(['remove', id]),
    onCancel: () => calls.push(['cancel']),
    onExit: () => calls.push(['exit']),
    onMore: () => calls.push(['more']),
  };
});

ftest('hides original rows and pagination, inserts bar before table', () => {
  view();
  expect(origRows().length).toBeGreaterThan(0);
  expect(origRows().every((tr) => tr.style.display === 'none')).toBe(true);
  const all = [...doc.querySelector('table.bd_lst').tBodies[0].rows];
  expect(all.some((tr) => !tr.querySelector('td.title'))).toBe(true); // folded notice / ad rows exist
  expect(all.every((tr) => tr.style.display === 'none')).toBe(true);
  expect(doc.querySelector('form.bd_pg').style.display).toBe('none');
  expect(doc.querySelector('table.bd_lst').previousElementSibling.id).toBe('fmf-results-bar');
});
ftest('renders result rows with badges in order', () => {
  const v = view();
  const state = st();
  v.render(state, ctx);
  const out = [...doc.querySelectorAll('table.bd_lst tr[data-fmf-result]')];
  expect(out.length).toBe(3);
  expect(out.map((tr) => tr.querySelector('td.title > a:not(.replyNum)').getAttribute('href'))).toEqual(
    state.rows.map((r) => `https://www.fmkorea.com/${r.docId}${ctx.linkHash}`),
  );
  expect([...out[0].querySelectorAll('.fmf-hit')].map((e) => e.textContent)).toEqual(['목동', '스에웨']);
  expect(out[0].ownerDocument).toBe(doc);
});
ftest('re-render replaces rows', () => {
  const v = view();
  v.render(st(), ctx);
  v.render(st(), ctx);
  expect(doc.querySelectorAll('tr[data-fmf-result]').length).toBe(3);
});
ftest('running shows progress and cancel', () => {
  const v = view();
  v.render(st({ status: 'running', progress: { done: 2, total: 5 }, moreLabel: null }), ctx);
  expect(barText()).toContain('검색 중 2/5');
  [...doc.querySelectorAll('#fmf-results-bar button')].find((b) => b.textContent === '취소').click();
  expect(calls).toEqual([['cancel']]);
  expect(doc.getElementById('fmf-foot').textContent).toBe('불러오는 중…');
});
ftest('bar shows title, category and chips; chip ✕ calls onRemoveBrand with id', () => {
  const v = view();
  v.render(st(), ctx);
  expect(barText()).toContain('브랜드 모아보기');
  expect(barText()).toContain('착샷');
  doc.querySelector('#fmf-results-bar [data-brand="anotheroffice"] button').click();
  expect(calls).toEqual([['remove', 'anotheroffice']]);
  [...doc.querySelectorAll('#fmf-results-bar button')].find((b) => b.textContent === '원래 목록으로').click();
  expect(calls.at(-1)).toEqual(['exit']);
});
ftest('footer states', () => {
  const v = view();
  v.render(st({ moreLabel: '이어서 검색' }), ctx);
  const btn = doc.querySelector('#fmf-foot button');
  expect(btn.textContent).toBe('이어서 검색');
  btn.click();
  expect(calls).toEqual([['more']]);
  v.render(st({ moreLabel: null, finished: true }), ctx);
  expect(doc.getElementById('fmf-foot').textContent).toBe('끝');
  v.render(st({ moreLabel: '더 보기' }), ctx);
  expect(doc.getElementById('fmf-foot').textContent).toBe('');
});
ftest('sentinel loads more when visible', () => {
  const v = view();
  v.render(st({ status: 'running', progress: { done: 0, total: 2 }, moreLabel: null }), ctx);
  obs.fire();
  expect(calls).toEqual([]);
  v.render(st(), ctx);
  obs.fire();
  obs.fire();
  expect(calls).toEqual([['more']]);
  expect(doc.getElementById('fmf-sentinel').previousElementSibling.id).toBe('fmf-foot');
});
ftest('re-arms after render while sentinel stays visible', () => {
  const v = view();
  const a0 = obs.arms;
  v.render(st(), ctx);
  v.render(st(), ctx);
  expect(obs.arms).toBe(a0 + 2);
  v.render(st({ moreLabel: null, finished: true }), ctx);
  expect(obs.arms).toBe(a0 + 2);
  obs.fire();
  expect(calls).toEqual([]);
});
ftest('rewrites title and reply links, leaves others', () => {
  const v = view();
  const state = st();
  state.rows[0].tr.querySelector('td.title').append(Object.assign(doc.createElement('a'), { href: '/member/1', textContent: 'x' }));
  v.render(state, ctx);
  const tr = doc.querySelector('tr[data-fmf-result]');
  const id = state.rows[0].docId;
  expect(tr.querySelector('td.title > a:not(.replyNum)').getAttribute('href')).toBe(`https://www.fmkorea.com/${id}#fmf=b:x;c:all`);
  const reply = tr.querySelector('a.replyNum');
  if (reply) expect(reply.getAttribute('href')).toBe(`https://www.fmkorea.com/${id}#fmf=b:x;c:all`);
  expect(tr.querySelector('a[href="/member/1"]')).not.toBeNull();
  expect(tr.querySelector('td.title').innerHTML).not.toContain('search_keyword');
});
ftest('browse bar shows hidden count and no chips', () => {
  const v = view();
  v.render(st({ mode: 'browse', rows: rows().map((r) => ({ ...r, hits: [] })) }), { ...ctx, brands: [], hiddenCount: 2 });
  expect(barText()).toContain('숨김 2개 제외');
  expect(doc.querySelector('#fmf-results-bar [data-brand]')).toBeNull();
  expect(doc.querySelector('tr[data-fmf-result] .fmf-hit')).toBeNull();
});
ftest('notices', () => {
  const v = view();
  v.render(st({ status: 'blocked' }), ctx);
  expect(barText()).toContain('펨코 보안 확인이 필요해요. 새로고침 후 다시 시도해 주세요');
  v.render(st({ rows: [], moreLabel: null, finished: true }), ctx);
  expect(barText()).toContain('조건에 맞는 글이 없어요');
  v.render(st({ notice: 'limited' }), ctx);
  expect(barText()).toContain('펨코가 잠시 요청을 제한했어요');
  v.render(st({ notice: 'unrecognized' }), ctx);
  expect(barText()).toContain('펨코 화면 구조가 바뀐 것 같아요');
  v.render(st({ jobCount: 30, totalTerms: 35 }), { ...ctx, totalTerms: 35 });
  expect(barText()).toContain('별명 35개 중 30개만 검색');
});
ftest('destroy restores the original page', () => {
  const target = origRows().filter((tr) => !tr.classList.contains('notice'))[3];
  target.querySelector('td.title > a:not(.replyNum)').textContent = '파프터 CS';
  applyHiding(doc, ['fafter'], matchers);
  expect(doc.getElementById('fmf-bar')).not.toBeNull();
  const v = view();
  expect(doc.getElementById('fmf-bar')).toBeNull();
  v.render(st(), ctx);
  v.destroy();
  expect(doc.querySelectorAll('[data-fmf-result]').length).toBe(0);
  expect(doc.getElementById('fmf-results-bar')).toBeNull();
  expect(doc.getElementById('fmf-foot')).toBeNull();
  expect(doc.getElementById('fmf-sentinel')).toBeNull();
  expect(doc.querySelector('form.bd_pg').style.display).toBe('');
  expect(target.style.display).toBe('none');
  expect(origRows().filter((tr) => tr !== target).every((tr) => tr.style.display === '')).toBe(true);
});
ftest('creates a table when the page has none', () => {
  doc = new DOMParser().parseFromString(EMPTY, 'text/html');
  expect(doc.querySelector('table.bd_lst')).toBeNull();
  const v = view();
  v.render(st(), ctx);
  expect(doc.querySelectorAll('table.bd_lst').length).toBe(1);
  expect(doc.querySelectorAll('table.bd_lst tr[data-fmf-result]').length).toBe(3);
  v.destroy();
  expect(doc.querySelector('table.bd_lst')).toBeNull();
});

ftest('manual 더 보기 when auto-load is off', () => {
  const v = view();
  const a0 = obs.arms;
  v.render(st({ autoLoad: false }), ctx);
  expect(obs.arms).toBe(a0);
  obs.fire();
  expect(calls).toEqual([]);
  const btn = doc.querySelector('#fmf-foot button');
  expect(btn.textContent).toBe('더 보기');
  btn.click();
  expect(calls).toEqual([['more']]);
});
ftest('pause() stops sentinel loads until the next render', () => {
  const v = view();
  v.render(st(), ctx);
  v.pause();
  obs.fire();
  expect(calls).toEqual([]);
});
ftest('re-render keeps existing row nodes and updates badges', () => {
  const v = view();
  const state = st();
  v.render(state, ctx);
  const first = doc.querySelector('tr[data-fmf-result]');
  const more = { ...state, rows: state.rows.map((r, i) => (i === 0 ? { ...r, hits: [...r.hits, { brandId: 'x', term: 'SEW' }] } : r)) };
  v.render(more, ctx);
  const again = doc.querySelector('tr[data-fmf-result]');
  expect(again).toBe(first);
  expect([...again.querySelectorAll('.fmf-hit')].map((e) => e.textContent)).toEqual(['목동', '스에웨', 'SEW']);
  v.render({ ...state, rows: state.rows.slice(1) }, ctx);
  expect(first.isConnected).toBe(false);
  expect(doc.querySelectorAll('tr[data-fmf-result]').length).toBe(2);
});
ftest('rows are re-ordered when a newer row arrives', () => {
  const v = view();
  const state = st();
  v.render({ ...state, rows: state.rows.slice(1) }, ctx);
  v.render(state, ctx);
  const ids = [...doc.querySelectorAll('tr[data-fmf-result] td.title > a:not(.replyNum)')].map((a) => a.getAttribute('href'));
  expect(ids).toEqual(state.rows.map((r) => `https://www.fmkorea.com/${r.docId}${ctx.linkHash}`));
});
