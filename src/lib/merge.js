import { matchBrands } from './matcher.js';

/** @typedef {import('./parser.js').Row} Row */
/** @typedef {Row & { hits: Array<{ brandId: string, term: string }> }} ResultRow */

/**
 * @param {Row[]} rows
 * @param {{ category: import('./dictionary.js').Category, hiddenBrandIds: string[], matchers: import('./matcher.js').Matchers }} opts
 * @returns {Row[]}
 */
export function filterRows(rows, { category, hiddenBrandIds, matchers }) {
  const ids = new Set(category.ids);
  const excl = new Set(category.excludeIds ?? []);
  return rows.filter((r) => {
    if (ids.size && !ids.has(r.categoryId ?? '')) return false;
    if (r.categoryId && excl.has(r.categoryId)) return false;
    return matchBrands(r.title, hiddenBrandIds, matchers).length === 0;
  });
}

/**
 * @param {ResultRow[]} existing
 * @param {Row[]} incoming
 * @param {string} brandId
 * @param {string} term
 * @returns {ResultRow[]} new array, newest (highest docId) first
 */
export function mergeRows(existing, incoming, brandId, term) {
  const map = new Map(existing.map((r) => [r.docId, r]));
  for (const r of incoming) {
    const prev = map.get(r.docId);
    const hits = prev ? prev.hits : [];
    const has = hits.some((h) => h.brandId === brandId && h.term === term);
    map.set(r.docId, { ...(prev ?? r), hits: has ? hits : [...hits, { brandId, term }] });
  }
  return [...map.values()].sort((a, b) => b.docId - a.docId);
}
