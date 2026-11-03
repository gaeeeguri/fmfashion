import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { compileMatchers } from '../../src/lib/matcher.js';
import { mergeRows, filterRows } from '../../src/lib/merge.js';

const row = (docId, extra = {}) => ({
  docId, title: `글 ${docId}`, url: `https://www.fmkorea.com/${docId}`, categoryId: '18910473', categoryName: '착샷',
  author: 'a', time: '10.30', views: 1, votes: 0, comments: 0, ...extra,
});
const cat = (key) => bundled.categories.find((c) => c.key === key);
const matchers = compileMatchers(bundled);

test('dedupes by docId and accumulates hits', () => {
  let r = mergeRows([], [row(1)], 'steadyeverywhere', '스에웨');
  r = mergeRows(r, [row(1)], 'steadyeverywhere', 'SEW');
  r = mergeRows(r, [row(1)], 'steadyeverywhere', 'SEW');
  expect(r.length).toBe(1);
  expect(r[0].hits).toEqual([
    { brandId: 'steadyeverywhere', term: '스에웨' },
    { brandId: 'steadyeverywhere', term: 'SEW' },
  ]);
});
test('sorted newest first', () => {
  const r = mergeRows([], [row(5), row(9), row(7)], 'paf', '파프');
  expect(r.map((x) => x.docId)).toEqual([9, 7, 5]);
});
test('category ids filter', () => {
  const rows = [row(1, { categoryId: '186586714' }), row(2, { categoryId: '4022646597' })];
  expect(filterRows(rows, { category: cat('fit'), hiddenBrandIds: [], matchers }).map((r) => r.docId)).toEqual([1]);
});
test('all category excludes notice/event/graveyard', () => {
  const rows = [row(1, { categoryId: '210029879' }), row(2, { categoryId: '4022646597' }), row(3, { categoryId: null })];
  expect(filterRows(rows, { category: cat('all'), hiddenBrandIds: [], matchers }).map((r) => r.docId)).toEqual([2, 3]);
});
test('hidden brand titles removed', () => {
  const rows = [row(1, { title: '파프터 CS 후기' }), row(2, { title: '파프 셔츠' })];
  expect(filterRows(rows, { category: cat('all'), hiddenBrandIds: ['fafter'], matchers }).map((r) => r.docId)).toEqual([2]);
});
test('does not mutate input', () => {
  const existing = mergeRows([], [row(1)], 'paf', '파프');
  const snapshot = structuredClone(existing);
  const incoming = [row(1), row(2)];
  const incomingSnap = structuredClone(incoming);
  mergeRows(existing, incoming, 'paf', 'PAF');
  expect(existing).toEqual(snapshot);
  expect(incoming).toEqual(incomingSnap);
});

test('mergeRows with null brand adds no hit', () => {
  const out = mergeRows([], [row(5)], null, '');
  expect(out.length).toBe(1);
  expect(out[0].hits).toEqual([]);
});
