// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest';
import { fixture, ftest, dtest, HAS_FIXTURES } from './fixtures.js';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { isFashionListUrl, applyHiding, isListPage, needsResync, classifyPage } from '../../src/lib/boardPage.js';

const B = 'https://www.fmkorea.com';
const HTML = fixture('board-list.html');
const matchers = compileMatchers(bundled);
let doc;
let target;

beforeEach(() => {
  if (!HAS_FIXTURES) return;
  doc = new DOMParser().parseFromString(HTML, 'text/html');
  target = [...doc.querySelectorAll('tr:not(.notice) td.title > a:not(.replyNum)')][3];
  target.textContent = '파프터 CS 또 터짐';
});

test.each([
  [`${B}/fashion`, true],
  [`${B}/fashion?page=2`, true],
  [`${B}/index.php?mid=fashion&category=18910473&page=2`, true],
  [`${B}/search.php?mid=fashion&search_keyword=x`, true],
  [`${B}/10501045295`, false],
  [`${B}/index.php?mid=fashion&document_srl=1`, false],
  [`${B}/search.php?mid=fashion&document_srl=1&search_keyword=x`, false],
  [`${B}/index.php?mid=football`, false],
  [`${B}/best`, false],
  [`${B}/fashionista`, false],
])('isFashionListUrl(%s) = %s', (url, want) => expect(isFashionListUrl(url)).toBe(want));

ftest('hides matching rows and counts', () => {
  const { hiddenCount } = applyHiding(doc, ['fafter'], matchers);
  expect(hiddenCount).toBe(1);
  const tr = target.closest('tr');
  expect(tr.dataset.fmfHidden).toBe('1');
  expect(tr.style.display).toBe('none');
  expect(doc.getElementById('fmf-bar').textContent).toContain('숨긴 글 1개');
});
ftest('no bar when nothing hidden', () => {
  expect(applyHiding(doc, [], matchers).hiddenCount).toBe(0);
  expect(doc.getElementById('fmf-bar')).toBeNull();
});
ftest('idempotent', () => {
  applyHiding(doc, ['fafter'], matchers);
  const { hiddenCount } = applyHiding(doc, ['fafter'], matchers);
  expect(hiddenCount).toBe(1);
  expect(doc.querySelectorAll('#fmf-bar').length).toBe(1);
});
ftest('unhiding restores rows and removes bar', () => {
  applyHiding(doc, ['fafter'], matchers);
  applyHiding(doc, [], matchers);
  expect(target.closest('tr').style.display).toBe('');
  expect(target.closest('tr').dataset.fmfHidden).toBeUndefined();
  expect(doc.getElementById('fmf-bar')).toBeNull();
});
ftest('toggle shows and rehides', () => {
  applyHiding(doc, ['fafter'], matchers);
  const btn = doc.querySelector('#fmf-bar button');
  btn.click();
  expect(target.closest('tr').style.display).toBe('');
  expect(btn.textContent).toBe('다시 숨기기');
  btn.click();
  expect(target.closest('tr').style.display).toBe('none');
  expect(btn.textContent).toBe('보기');
});

const docOf = (f) => new DOMParser().parseFromString(fixture(f), 'text/html');
ftest('isListPage: list and zero-result pages yes, security page no', () => {
  expect(isListPage(docOf('board-list.html'))).toBe(true);
  expect(isListPage(docOf('search-empty.html'))).toBe(true);
  expect(isListPage(docOf('blocked-430.html'))).toBe(false);
});
test('isListPage: unknown page no', () => {
  expect(isListPage(new DOMParser().parseFromString('<html><body>점검 중</body></html>', 'text/html'))).toBe(false);
});
test('needsResync only when hidden brands or the dictionary change', () => {
  const s = (hidden, selected = []) => ({ hiddenBrandIds: hidden, selectedBrandIds: selected, categoryKey: 'all' });
  // popup chip / category clicks: hidden list unchanged → no re-search
  expect(needsResync({ settings: { oldValue: s(['a']), newValue: s(['a'], ['x']) } }, 'sync')).toBe(false);
  expect(needsResync({ settings: { oldValue: s(['a', 'b']), newValue: s(['b', 'a']) } }, 'sync')).toBe(false);
  expect(needsResync({ settings: { oldValue: s(['a']), newValue: s(['a', 'b']) } }, 'sync')).toBe(true);
  expect(needsResync({ settings: { newValue: s(['a']) } }, 'sync')).toBe(true);
  expect(needsResync({ dictionary: { newValue: {} } }, 'local')).toBe(true);
  expect(needsResync({ other: {} }, 'sync')).toBe(false);
});

const docHtml = () => fixture('document.html');
dtest('fashion post is a document with list root', () => {
  const d = new DOMParser().parseFromString(docHtml(), 'text/html');
  const page = classifyPage('https://www.fmkorea.com/10513685492', d);
  expect(page.kind).toBe('document');
  expect(page.listRoot.querySelector('table.bd_lst')).not.toBeNull();
  expect(classifyPage('https://www.fmkorea.com/index.php?mid=fashion&document_srl=10513685492', d).kind).toBe('document');
});
dtest('other-board post is not a fashion document', () => {
  const html = docHtml().replaceAll('href="/fashion"', 'href="/football"').replaceAll('value="fashion"', 'value="football"');
  const d = new DOMParser().parseFromString(html, 'text/html');
  expect(classifyPage('https://www.fmkorea.com/10513685492', d)).toBeNull();
});
ftest('list page classifies as list', () => {
  const d = docOf('board-list.html');
  const page = classifyPage('https://www.fmkorea.com/fashion', d);
  expect(page.kind).toBe('list');
  expect(page.listRoot.querySelector('table.bd_lst')).not.toBeNull();
  expect(classifyPage('https://www.fmkorea.com/best', d)).toBeNull();
});
ftest('blocked page → null', () => {
  expect(classifyPage('https://www.fmkorea.com/fashion', docOf('blocked-430.html'))).toBeNull();
  expect(classifyPage('https://www.fmkorea.com/10513685492', docOf('blocked-430.html'))).toBeNull();
});
