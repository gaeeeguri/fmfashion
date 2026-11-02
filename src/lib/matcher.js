/** @typedef {import('./dictionary.js').Dictionary} Dictionary */
/** @typedef {Map<string, RegExp[]>} Matchers */

/**
 * @param {Dictionary} dict
 * @returns {Matchers}
 */
export function compileMatchers(dict) {
  const out = new Map();
  for (const b of dict.brands) out.set(b.id, b.matchPatterns.map((p) => new RegExp(p, 'iu')));
  return out;
}

/**
 * @param {string} title
 * @param {string[]} brandIds
 * @param {Matchers} matchers
 * @returns {string[]} brandIds whose patterns match, in input order
 */
export function matchBrands(title, brandIds, matchers) {
  return brandIds.filter((id) => (matchers.get(id) ?? []).some((re) => re.test(title)));
}
