import { test, expect } from 'vitest';
import { fixture, ftest, dtest } from '../../lib/fixtures.js';
import { parseList, parsePost, classify } from '../../../tools/crawl/parse.js';

const EXCLUDE = ['210029879', '209960683', '5263961399'];

test('parsePost extracts body text, image count and date', () => {
  const html =
    '<div class="top_area"><span class="date">2026.11.03 13:24</span></div>' +
    '<article><div class="xe_content"><p>파프터는 비싸고....</p><p></p><p>흠<br>안사면</p><img src=x></div></article>';
  expect(parsePost(html)).toEqual({ text: '파프터는 비싸고....\n흠\n안사면', imgCount: 1, date: '2026.11.03 13:24' });
});

test('parsePost returns null without a post body', () => {
  expect(parsePost('<html><body>로그인</body></html>')).toBeNull();
});

test('parseList drops rows in excluded categories', () => {
  const row = (id, cat) =>
    `<tr><td class="cate"><a href="/index.php?mid=fashion&category=${cat}">c</a></td>` +
    `<td class="title"><a href="/${id}">t${id}</a></td></tr>`;
  const html = `<table>${row(111, '210029879')}${row(222, '26143773')}</table>`;
  const { rows } = parseList(html, EXCLUDE);
  expect(rows).toEqual([{ docId: '222', title: 't222', categoryId: '26143773', categoryName: 'c' }]);
});

test('parseList reads last page from the pager form', () => {
  const html = '<div class="bd_lst_wrp"><table></table></div><form class="bd_pg" data-last-page="4321"></form>';
  expect(parseList(html, EXCLUDE).lastPage).toBe(4321);
  expect(parseList('<table></table>', EXCLUDE).lastPage).toBeNull();
});

test('classify maps responses to crawl outcomes', () => {
  expect(classify({ status: 429, html: '' })).toBe('rate-limited');
  expect(classify({ status: 430, html: '' })).toBe('blocked');
  expect(classify({ status: 200, html: '<p>에펨코리아 보안 시스템</p>' })).toBe('blocked');
  expect(classify({ error: 'timeout' })).toBe('network');
  expect(classify({ error: 'network' })).toBe('network');
  expect(classify({ status: 404, html: '' })).toBe('http-error');
  expect(classify({ status: 200, html: '<p>ok</p>' })).toBe('ok');
});

ftest('fixture board list has 20 rows with string doc ids', () => {
  const { rows } = parseList(fixture('board-list.html'), EXCLUDE);
  expect(rows.length).toBe(20);
  expect(rows.every((r) => /^\d+$/.test(r.docId))).toBe(true);
});

dtest('fixture post body', () => {
  expect(parsePost(fixture('document.html'))).toMatchObject({
    text: '파프터는 비싸고....\n흠 안사면 공짜인가',
    date: '2026.11.03 13:24',
  });
});
