// @vitest-environment jsdom
import { test, expect } from 'vitest';
import fs from 'node:fs';
import { parseListHtml, isBlockedHtml, hasListTable } from '../../src/lib/parser.js';

const read = (f) => fs.readFileSync(`tests/fixtures/${f}`, 'utf8');

test('board list rows', () => {
  const rows = parseListHtml(read('board-list.html'));
  expect(rows.length).toBe(20);
  expect(rows.every((r) => Number.isInteger(r.docId) && r.docId > 0 && r.title.length > 0)).toBe(true);
});
test('skips notice and ad rows', () => {
  const rows = parseListHtml(read('board-list.html'));
  expect(rows.some((r) => r.categoryName === '공지')).toBe(false);
  expect(rows.some((r) => /신청하기/.test(r.title))).toBe(false);
});
test('ad-like row without document link is skipped', () => {
  const html = '<table><tbody><tr><td class="cate">AD</td><td class="title"><a href="/ad/apply">신청하기</a></td></tr></tbody></table>';
  expect(parseListHtml(html)).toEqual([]);
});
test('search result rows use document_srl', () => {
  const rows = parseListHtml(read('search-result.html'));
  expect(rows.length).toBe(20);
  expect(rows.find((r) => r.docId === 10501045295)).toMatchObject({
    categoryName: '착샷',
    categoryId: '18910473',
    url: 'https://www.fmkorea.com/10501045295',
    author: '롱슬',
    time: '10.30',
    views: 2956,
    votes: 13,
  });
});
test('title excludes reply count', () => {
  const r = parseListHtml(read('search-result.html')).find((r) => r.docId === 10501045295);
  expect(r.title).toBe('오늘 착샷');
  expect(r.comments).toBe(3);
});
test('blocked page detected', () => {
  expect(isBlockedHtml(read('blocked-430.html'))).toBe(true);
  expect(isBlockedHtml(read('board-list.html'))).toBe(false);
  expect(parseListHtml(read('blocked-430.html'))).toEqual([]);
});
test('zero-result search page still has the list table', () => {
  const html = read('search-empty.html');
  expect(hasListTable(html)).toBe(true);
  expect(parseListHtml(html)).toEqual([]);
});
test('unrecognized page has no list table', () => {
  expect(hasListTable('<html><body><p>로그인이 필요합니다</p></body></html>')).toBe(false);
  expect(hasListTable(read('board-list.html'))).toBe(true);
});
