import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { buildSearchJobs, buildSearchUrl } from '../../src/lib/query.js';

test('expands aliases with hidden exclusions', () => {
  const { jobs, totalTerms } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['anotheroffice'], hiddenBrandIds: ['fafter'] });
  expect(jobs.map((j) => j.keyword)).toEqual(['어나더오피스 !파프터', '목동 !파프터']);
  expect(totalTerms).toBe(2);
});
test('brand-level exclude always kept', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['paf'], hiddenBrandIds: [] });
  expect(jobs[0].keyword).toBe('파프 !파프터');
});
test('round-robin and cap', () => {
  const { jobs, totalTerms } = buildSearchJobs({
    dict: bundled, selectedBrandIds: ['steadyeverywhere', 'anotheroffice'], hiddenBrandIds: [], maxRequests: 3,
  });
  expect(jobs.map((j) => j.term)).toEqual(['스테디에브리웨어', '어나더오피스', '스테디']);
  expect(totalTerms).toBeGreaterThan(3);
});
test('hidden brand removed from selection', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['fafter', 'paf'], hiddenBrandIds: ['fafter'] });
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.brandId === 'paf')).toBe(true);
});
test('keyword length cap drops hidden exclusions first', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['paf'], hiddenBrandIds: ['firstfloor', 'fafter'], maxKeywordLength: 12 });
  expect(jobs[0].keyword.startsWith('파프 !파프터')).toBe(true);
  expect(jobs[0].keyword.length).toBeLessThanOrEqual(12);
});
test('hidden term contained in the search term is not excluded', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['fafter'], hiddenBrandIds: ['paf'] });
  expect(jobs[0].keyword).toBe('파프터');
});
test('duplicate terms across brands searched once', () => {
  const d = structuredClone(bundled);
  d.brands.find((b) => b.id === 'pottery').searchTerms.push('sew');
  const { jobs } = buildSearchJobs({ dict: d, selectedBrandIds: ['steadyeverywhere', 'pottery'], hiddenBrandIds: [] });
  expect(jobs.filter((j) => j.term.toLowerCase() === 'sew').length).toBe(1);
});
test('buildSearchUrl encodes', () => {
  expect(buildSearchUrl('파프 !파프터', 2)).toBe(
    'https://www.fmkorea.com/search.php?mid=fashion&search_target=title_content&search_keyword=%ED%8C%8C%ED%94%84+%21%ED%8C%8C%ED%94%84%ED%84%B0&page=2',
  );
});
test('buildSearchUrl with category', () => {
  expect(buildSearchUrl('a', 1, '18910473')).toMatch(/&category=18910473$/);
});
