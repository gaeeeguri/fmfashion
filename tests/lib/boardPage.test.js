// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest';
import { fixture, ftest, HAS_FIXTURES } from './fixtures.js';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { isFashionListUrl, applyHiding } from '../../src/lib/boardPage.js';

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
