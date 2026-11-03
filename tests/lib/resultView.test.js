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

const rows = (n = 3) =>
  parseSearchPage(fixture('search-result.html'))
    .items.slice(0, n)
    .map(({ row, tr }, i) => ({ ...row, tr, hits: [{ brandId: 'anotheroffice', term: '목동' }, ...(i === 0 ? [{ brandId: 'steadyeverywhere', term: '스에웨' }] : [])] }));
const ctx = { brands: [{ id: 'steadyeverywhere', name: '스테디에브리웨어' }, { id: 'anotheroffice', name: '어나더오피스' }], categoryName: '착샷', totalTerms: 7 };
const st = (o = {}) => ({ status: 'done', rows: rows(), progress: null, totalTerms: 7, jobCount: 7, notice: null, moreLabel: '더 보기', finished: false, ...o });
const origRows = () => [...doc.querySelectorAll('table.bd_lst tr')].filter((tr) => tr.querySelector('td.title') && !tr.hasAttribute('data-fmf-result'));
const barText = () => doc.getElementById('fmf-results-bar').textContent;

beforeEach(() => {
  if (!HAS_FIXTURES) return;
  doc = new DOMParser().parseFromString(BOARD, 'text/html');
  calls = [];
  handlers = {
    onRemoveBrand: (id) => calls.push(['remove', id]),
    onCancel: () => calls.push(['cancel']),
    onExit: () => calls.push(['exit']),
    onMore: () => calls.push(['more']),
  };
});

ftest('hides original rows and pagination, inserts bar before table', () => {
  createResultView(doc, handlers);
  expect(origRows().length).toBeGreaterThan(0);
  expect(origRows().every((tr) => tr.style.display === 'none')).toBe(true);
  expect(doc.querySelector('form.bd_pg').style.display).toBe('none');
  expect(doc.querySelector('table.bd_lst').previousElementSibling.id).toBe('fmf-results-bar');
});
ftest('renders result rows with badges in order', () => {
  const v = createResultView(doc, handlers);
  const state = st();
  v.render(state, ctx);
  const out = [...doc.querySelectorAll('table.bd_lst tr[data-fmf-result]')];
  expect(out.length).toBe(3);
  expect(out.map((tr) => tr.querySelector('td.title > a:not(.replyNum)').getAttribute('href'))).toEqual(
    state.rows.map((r) => r.tr.querySelector('td.title > a:not(.replyNum)').getAttribute('href')),
  );
  expect([...out[0].querySelectorAll('.fmf-hit')].map((e) => e.textContent)).toEqual(['목동', '스에웨']);
  expect(out[0].ownerDocument).toBe(doc);
});
ftest('re-render replaces rows', () => {
  const v = createResultView(doc, handlers);
  v.render(st(), ctx);
  v.render(st(), ctx);
  expect(doc.querySelectorAll('tr[data-fmf-result]').length).toBe(3);
});
ftest('running shows progress and cancel', () => {
  const v = createResultView(doc, handlers);
  v.render(st({ status: 'running', progress: { done: 2, total: 5 }, moreLabel: null }), ctx);
  expect(barText()).toContain('검색 중 2/5');
  [...doc.querySelectorAll('#fmf-results-bar button')].find((b) => b.textContent === '취소').click();
  expect(calls).toEqual([['cancel']]);
  expect(doc.getElementById('fmf-more').hidden).toBe(true);
});
ftest('bar shows title, category and chips; chip ✕ calls onRemoveBrand with id', () => {
  const v = createResultView(doc, handlers);
  v.render(st(), ctx);
  expect(barText()).toContain('브랜드 모아보기');
  expect(barText()).toContain('착샷');
  doc.querySelector('#fmf-results-bar [data-brand="anotheroffice"] button').click();
  expect(calls).toEqual([['remove', 'anotheroffice']]);
  [...doc.querySelectorAll('#fmf-results-bar button')].find((b) => b.textContent === '원래 목록으로').click();
  expect(calls.at(-1)).toEqual(['exit']);
});
ftest('more button follows moreLabel; finished shows 끝', () => {
  const v = createResultView(doc, handlers);
  v.render(st({ moreLabel: '이어서 검색' }), ctx);
  const more = doc.getElementById('fmf-more');
  expect(more.textContent).toBe('이어서 검색');
  expect(more.hidden).toBe(false);
  more.click();
  expect(calls).toEqual([['more']]);
  v.render(st({ moreLabel: null, finished: true }), ctx);
  expect(doc.getElementById('fmf-more').hidden).toBe(true);
  expect(doc.getElementById('fmf-end').hidden).toBe(false);
  expect(doc.getElementById('fmf-end').textContent).toBe('끝');
});
ftest('notices', () => {
  const v = createResultView(doc, handlers);
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
  const v = createResultView(doc, handlers);
  expect(doc.getElementById('fmf-bar')).toBeNull();
  v.render(st(), ctx);
  v.destroy();
  expect(doc.querySelectorAll('[data-fmf-result]').length).toBe(0);
  expect(doc.getElementById('fmf-results-bar')).toBeNull();
  expect(doc.getElementById('fmf-more')).toBeNull();
  expect(doc.querySelector('form.bd_pg').style.display).toBe('');
  expect(target.style.display).toBe('none');
  expect(origRows().filter((tr) => tr !== target).every((tr) => tr.style.display === '')).toBe(true);
});
ftest('creates a table when the page has none', () => {
  doc = new DOMParser().parseFromString(EMPTY, 'text/html');
  expect(doc.querySelector('table.bd_lst')).toBeNull();
  const v = createResultView(doc, handlers);
  v.render(st(), ctx);
  expect(doc.querySelectorAll('table.bd_lst').length).toBe(1);
  expect(doc.querySelectorAll('table.bd_lst tr[data-fmf-result]').length).toBe(3);
  v.destroy();
  expect(doc.querySelector('table.bd_lst')).toBeNull();
});
